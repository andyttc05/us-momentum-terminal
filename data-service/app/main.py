"""FastAPI entry point for the US Momentum Terminal data service.

Run from the repository root with ``npm run data:serve``.
"""

from __future__ import annotations

import json
import math
import sys
import threading
import time
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import cache  # noqa: E402
from app.clock import market_state  # noqa: E402
from app.config import DOCS_DIR, SEED_PATH, settings  # noqa: E402
from app.backtest import REBALANCE_FREQUENCIES, REBALANCE_LABELS  # noqa: E402
from app.cashflow import normalize_frequency as normalize_cashflow_frequency  # noqa: E402
from app.providers.registry import registry  # noqa: E402
from app.snapshot import (  # noqa: E402
    PUBLICATION_VERSION,
    UNIVERSE_VERSION,
    build_bars,
    build_publication,
    build_stock_detail,
    publication_is_current,
    refresh,
    run_historical_backtest,
    snapshot_age_seconds,
)

app = FastAPI(title="US Momentum Terminal Data Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://andyttc05.github.io",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_WARMING = {
    "active": False,
    "error": None,
    "started_at": None,
    "completed_at": None,
    "phase": "idle",
    "completed": 0,
    "total": 0,
}
_WARMING_LOCK = threading.Lock()
_BACKTEST_LOCK = threading.Lock()


def _progress(phase: str, completed: int, total: int) -> None:
    with _WARMING_LOCK:
        _WARMING.update(phase=phase, completed=completed, total=total)


def _warm_up(force: bool = False) -> None:
    try:
        build_publication(force=force, progress=_progress)
    except Exception as exc:  # noqa: BLE001 - surfaced through /api/health
        with _WARMING_LOCK:
            _WARMING["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        with _WARMING_LOCK:
            _WARMING.update(active=False, completed_at=time.time(), phase="idle")


def _start_warm_up(force: bool = False) -> bool:
    with _WARMING_LOCK:
        if _WARMING["active"]:
            return False
        if (
            _WARMING["error"]
            and _WARMING["completed_at"]
            and time.time() - _WARMING["completed_at"] < settings.warm_error_cooldown
        ):
            return False
        _WARMING.update(
            active=True,
            error=None,
            started_at=time.time(),
            completed_at=None,
            phase="starting",
            completed=0,
            total=0,
        )
    threading.Thread(target=_warm_up, args=(force,), name="publication-refresh", daemon=True).start()
    return True


def _is_current(payload: dict | None) -> bool:
    return publication_is_current(payload)


def _publication_state(payload: dict, cache_state: str) -> dict:
    result = deepcopy(payload)
    meta = result.setdefault("meta", {})
    meta["cache_state"] = cache_state
    meta["refresh_in_progress"] = _refresh_visible()
    return result


def _refresh_timed_out() -> bool:
    started = _WARMING.get("started_at")
    return bool(_WARMING["active"] and started and time.time() - started >= settings.warm_timeout)


def _refresh_visible() -> bool:
    return bool(_WARMING["active"] and not _refresh_timed_out())


def _seed_payload() -> dict | None:
    try:
        payload = json.loads(SEED_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("value", payload)
    meta = value.get("meta", {})
    return (
        value
        if meta.get("universe_version") == UNIVERSE_VERSION and value.get("stocks")
        else None
    )


def _loading_payload(error: str | None = None) -> dict:
    clock = market_state()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "meta": {
            "generated_at": now,
            "as_of": clock["session_date"],
            "as_of_label": None,
            "data_provider": registry.adapter(registry.chain()[0]).label,
            "data_provider_id": registry.chain()[0],
            "connection_status": "error" if error else "warming",
            "cache_state": "error" if error else "warming",
            "refresh_in_progress": _refresh_visible(),
            "market_state": clock["state"],
            "timeliness": clock["timeliness"],
            "timeliness_note": clock["timeliness_note"],
            "new_york_time": clock["new_york_time"],
            "degraded": True,
            "warnings": [error] if error else [],
            "universe_version": UNIVERSE_VERSION,
            "publication_version": PUBLICATION_VERSION,
            "providers": registry.status(),
        },
        "universe": {
            "requested": 0,
            "loaded": 0,
            "scanned": 0,
            "eligible": 0,
            "universe_eligible": 0,
            "momentum_eligible": 0,
            "excluded": [],
            "failures": [],
            "unavailable": [],
        },
        "stocks": [],
        "overview": {
            "snapshot": {"portfolioStocks": "—"},
            "topMomentum": [],
            "sectorAllocation": [],
            "performance": {},
        },
        "datasets": {},
        "portfolio": {
            "available": False,
            "holdings": [],
            "constraints": [],
            "reason": "warming" if not error else error,
        },
        "portfolios": {
            "top100": {"available": False, "holdings": [], "reason": "warming" if not error else error},
            "top20": {"available": False, "holdings": [], "reason": "warming" if not error else error},
        },
        "backtest": {
            "top100": {"available": False, "reason": "warming"},
            "top20": {"available": False, "reason": "warming"},
        },
    }


@app.on_event("startup")
def startup() -> None:
    _start_warm_up(force=False)


@app.get("/api/health")
def health() -> dict:
    publication_ok = cache.stored_at("publication", "snapshot") is not None
    return {
        "service": "us-momentum-data",
        "ok": True,
        "clock": market_state(),
        "snapshot_ready": publication_ok,
        "snapshot_age_seconds": snapshot_age_seconds(),
        "warming": {**_WARMING, "timed_out": _refresh_timed_out()},
        "universe_version": UNIVERSE_VERSION,
        "publication_version": PUBLICATION_VERSION,
        "providers": registry.status(),
        "configured_keys": settings.keys_present(),
        "provider_chain": registry.chain(),
    }


@app.get("/api/providers")
def providers() -> dict:
    return {
        "chain": registry.chain(),
        "providers": registry.status(),
        "configured_keys": settings.keys_present(),
    }


@app.get("/api/probe")
def probe_report() -> dict:
    """The last recorded live probe of every candidate provider."""
    path = DOCS_DIR / "provider_probe.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="no probe has been recorded yet")
    return json.loads(path.read_text())


@app.get("/api/snapshot")
def snapshot(force: bool = Query(default=False)) -> JSONResponse:
    payload = cache.read("publication", "snapshot", settings.ttl_snapshot)
    if _is_current(payload) and not force:
        response_payload = _publication_state(
            payload,
            "partial" if payload.get("universe", {}).get("partial") else "fresh",
        )
    else:
        stale = cache.read_stale("publication", "snapshot")
        seed = _seed_payload()
        _start_warm_up(force=force)
        if _is_current(payload):
            response_payload = _publication_state(payload, "cached")
        elif stale:
            response_payload = _publication_state(stale, "cached")
        elif seed:
            response_payload = _publication_state(seed, "cached")
        else:
            error = _WARMING["error"] or (
                "Data refresh timed out" if _refresh_timed_out() else None
            )
            response_payload = _loading_payload(error)
    response = JSONResponse(response_payload)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/stock/{ticker}")
def stock_detail(ticker: str) -> JSONResponse:
    detail = build_stock_detail(ticker)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"no verified data for {ticker.upper()}")
    response = JSONResponse(detail)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/bars/{ticker}")
def bars(ticker: str, days: int = Query(default=750, ge=30, le=3000)) -> JSONResponse:
    payload = build_bars(ticker, days)
    if not payload.get("bars"):
        raise HTTPException(status_code=404, detail=f"no bars for {ticker.upper()}")
    return JSONResponse(payload)


@app.post("/api/backtest")
def backtest(payload: dict = Body(default={})) -> JSONResponse:
    """Run a date-bounded backtest with the selected rebalance schedule."""
    portfolio = str(payload.get("portfolio", "top100")).strip().lower()
    frequency = str(payload.get("rebalance_frequency", "semiannual")).strip().lower()
    start_text = str(payload.get("start", "")).strip()
    end_text = str(payload.get("end", "")).strip()
    try:
        initial_capital = float(payload.get("initial_capital", 10_000.0))
        cashflow_amount = float(payload.get("cashflow_amount", 0.0))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="initial_capital and cashflow_amount must be numeric",
        ) from exc
    cashflow_enabled = payload.get("cashflow_enabled", False)
    if not isinstance(cashflow_enabled, bool):
        raise HTTPException(status_code=400, detail="cashflow_enabled must be a boolean")
    cashflow_direction = str(payload.get("cashflow_direction", "inflow")).strip().lower()
    try:
        cashflow_frequency = normalize_cashflow_frequency(
            str(payload.get("cashflow_frequency", "monthly"))
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if portfolio not in {"top100", "top20"}:
        raise HTTPException(status_code=400, detail="portfolio must be top100 or top20")
    if frequency not in REBALANCE_FREQUENCIES:
        raise HTTPException(
            status_code=400,
            detail=f"rebalance_frequency must be one of: {', '.join(REBALANCE_FREQUENCIES)}",
        )
    try:
        start = date.fromisoformat(start_text)
        end = date.fromisoformat(end_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="start and end must use YYYY-MM-DD") from exc
    if start >= end:
        raise HTTPException(status_code=400, detail="end must be after start")
    if not math.isfinite(initial_capital) or initial_capital <= 0:
        raise HTTPException(status_code=400, detail="initial_capital must be greater than zero")
    if cashflow_direction not in {"inflow", "outflow"}:
        raise HTTPException(status_code=400, detail="cashflow_direction must be inflow or outflow")
    if not math.isfinite(cashflow_amount) or cashflow_amount < 0:
        raise HTTPException(status_code=400, detail="cashflow_amount must be finite and non-negative")
    if cashflow_enabled and cashflow_amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="cashflow_amount must be greater than zero when cashflows are enabled",
        )

    with _BACKTEST_LOCK:
        result = run_historical_backtest(
            portfolio=portfolio,
            rebalance_frequency=frequency,
            start=start.isoformat(),
            end=end.isoformat(),
            initial_capital=initial_capital,
            cashflow_enabled=cashflow_enabled,
            cashflow_amount=cashflow_amount,
            cashflow_frequency=cashflow_frequency,
            cashflow_direction=cashflow_direction,
        )
    result["rebalanceLabel"] = REBALANCE_LABELS[frequency]
    response = JSONResponse(result)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/provider")
def choose_provider(payload: dict = Body(default={})) -> dict:
    """Switch the primary market-data source and rebuild the publication.

    The request only succeeds if the chosen provider actually served the data;
    otherwise the previous choice is restored, so the UI can never end up
    claiming a source it is not using.
    """
    provider_id = str(payload.get("id", "")).strip()
    previous = registry.preferred()
    try:
        registry.set_preferred(provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = refresh(force=True)
    except Exception as exc:  # noqa: BLE001
        if previous:
            registry.set_preferred(previous)
        else:
            registry.clear_preferred()
        raise HTTPException(status_code=502, detail=f"{provider_id} failed: {type(exc).__name__}: {exc}") from exc

    publication = cache.read("publication", "snapshot", ttl=-1) or {}
    served_by = (publication.get("meta") or {}).get("data_provider_id")
    if served_by != provider_id:
        if previous:
            registry.set_preferred(previous)
            refresh(force=True)
        else:
            registry.clear_preferred()
            refresh(force=True)
        raise HTTPException(
            status_code=409,
            detail=f"{provider_id} could not serve the universe; still using {served_by}.",
        )

    return {"ok": True, "provider": provider_id, **result}


@app.post("/api/refresh")
def force_refresh() -> dict:
    started = _start_warm_up(force=True)
    return {
        "ok": True,
        "refreshing": bool(_WARMING["active"]),
        "started": started,
        "phase": _WARMING["phase"],
    }


@app.get("/api/config")
def public_config() -> dict:
    """Non-secret configuration the UI may display."""
    return {
        "provider_chain": registry.chain(),
        "primary": registry.chain()[0],
        "history_years": settings.history_years,
        "configured_keys": settings.keys_present(),
        "missing_keys": [key for key, present in settings.keys_present().items() if not present],
    }

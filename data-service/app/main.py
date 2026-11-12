"""FastAPI entry point for the US Momentum Terminal data service.

Run from the repository root with ``npm run data:serve``.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import cache  # noqa: E402
from app.clock import market_state  # noqa: E402
from app.config import DOCS_DIR, settings  # noqa: E402
from app.providers.registry import registry  # noqa: E402
from app.snapshot import (  # noqa: E402
    build_bars,
    build_publication,
    build_stock_detail,
    refresh,
    snapshot_age_seconds,
)

app = FastAPI(title="US Momentum Terminal Data Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4173", "http://127.0.0.1:4173", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_WARMING = {"active": False, "error": None, "started_at": None}


def _warm_up() -> None:
    _WARMING.update(active=True, error=None, started_at=time.time())
    try:
        build_publication(force=False)
    except Exception as exc:  # noqa: BLE001 - surfaced through /api/health
        _WARMING["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        _WARMING["active"] = False


@app.on_event("startup")
def startup() -> None:
    threading.Thread(target=_warm_up, name="warm-up", daemon=True).start()


@app.get("/api/health")
def health() -> dict:
    publication_ok = cache.stored_at("publication", "snapshot") is not None
    return {
        "service": "us-momentum-data",
        "ok": True,
        "clock": market_state(),
        "snapshot_ready": publication_ok,
        "snapshot_age_seconds": snapshot_age_seconds(),
        "warming": _WARMING,
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
    if payload is None:
        if _WARMING["active"]:
            raise HTTPException(status_code=503, detail="warming up: first provider fetch in progress")
        try:
            payload = build_publication(force=force)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"provider failure: {type(exc).__name__}: {exc}") from exc
    response = JSONResponse(payload)
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
    try:
        return refresh(force=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"refresh failed: {type(exc).__name__}: {exc}") from exc


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

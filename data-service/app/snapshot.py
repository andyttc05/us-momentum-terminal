"""Builds everything the terminal displays from verified provider data.

The publication object is the single source of truth for the SPA. It is built
once per cache window and served as static JSON, so the browser never talks to
a data provider and never sees an API key.
"""

from __future__ import annotations

import json
import math
import threading
import time
from datetime import datetime, timezone

import pandas as pd

from . import cache
from .backtest import (
    LIQUIDITY_SESSIONS,
    MIN_AVERAGE_DAILY_DOLLAR_VOLUME,
    MIN_PRICE,
    MIN_UNIVERSE_OBSERVATIONS,
    REBALANCE_FREQUENCIES,
    historical_universe_eligible,
    rebalance_schedule,
    run_backtest,
)
from .clock import CALENDAR, market_state
from .config import SEED_PATH, settings
from . import size_history
from .macro import load_cpi
from .models import (
    NormalizedBar,
    ProviderAuthError,
    ProviderBlocked,
    ProviderError,
    ProviderNoData,
    SeriesResult,
    validate_bars,
)
from .momentum import (
    MIN_OBSERVATIONS,
    SymbolSeries,
    build_frame,
    compute_daily_change,
    compute_snapshot,
    cross_section_at,
    momentum_sparkline,
    monthly_history,
    sparkline_points,
)
from .portfolio import (
    MARKET_CAP_EXPONENT,
    METHODOLOGY_ID,
    SINGLE_NAME_CAP,
    SECTOR_CAP,
    WEIGHTING_METHOD_ID,
    build_portfolio,
    rank_for_selection,
)
from .providers.registry import registry
from .universe import (
    BENCHMARKS,
    HISTORICAL_BACKTEST_TICKERS,
    MEMBER_BY_TICKER,
    TICKERS,
    normalize_sector,
)

_WARM_LOCK = threading.Lock()
_BUILD_LOCK = threading.Lock()

PERFORMANCE_PERIODS = ("1Y", "3Y", "5Y", "All")
SERIES_COLORS = {"strategy": "#FFC83D", "spy": "#69A5F5", "spmo": "#AA8BF2"}
SUPPORTED_EXCHANGES = {"NYSE", "NASDAQ", "NYSE American"}
UNIVERSE_VERSION = "2026-11-12-live200-v2"
PUBLICATION_VERSION = "2026-11-14-cashflow-accounts-v14"
# The two published universes. Every page reads one of these datasets; there is
# no third "20%" variant and no page-local selection.
DATASET_UNIVERSES = ("top100", "top20")
DATASET_TARGET_HOLDINGS = {"top100": 100, "top20": 20}


def publication_is_current(payload: dict | None) -> bool:
    meta = (payload or {}).get("meta", {})
    return bool(
        meta.get("universe_version") == UNIVERSE_VERSION
        and meta.get("publication_version") == PUBLICATION_VERSION
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _label_date(iso: str) -> str:
    try:
        return datetime.strptime(iso[:10], "%Y-%m-%d").strftime("%b %d, %Y").replace(" 0", " ")
    except (ValueError, TypeError):
        return iso


def _verified_fundamental_fallbacks(
    payloads: list[dict | None],
    *,
    now: datetime | None = None,
) -> dict[str, dict]:
    """Collect recent, previously verified float-share records by ticker.

    These records never replace a successful current provider response. They
    keep portfolio construction available when a refresh can read prices but
    Yahoo's heavier fundamentals endpoint is temporarily unavailable.
    """
    current = now or datetime.now(timezone.utc)
    maximum_age = settings.fundamental_fallback_max_age
    fallbacks: dict[str, dict] = {}
    for payload in payloads:
        for stock in (payload or {}).get("stocks", []):
            ticker = str(stock.get("ticker") or "").upper()
            shares = stock.get("floatShares")
            fetched_at = stock.get("marketCapFetchedAt")
            if not ticker or ticker in fallbacks or not isinstance(shares, (int, float)) or shares <= 0:
                continue
            try:
                fetched = datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                continue
            if fetched.tzinfo is None:
                fetched = fetched.replace(tzinfo=timezone.utc)
            age_seconds = max(0.0, (current - fetched).total_seconds())
            if age_seconds > maximum_age:
                continue
            fallbacks[ticker] = {
                "float_shares": float(shares),
                "market_cap": stock.get("marketCap"),
                "fetched_at": fetched_at,
                "source": stock.get("quoteSource") or stock.get("source") or "yahoo",
                "source_label": stock.get("sourceLabel") or "Yahoo Finance",
                "cache_age_seconds": round(age_seconds, 1),
            }
    return fallbacks


def _merge_verified_fundamentals(
    scored: list[dict],
    quotes: dict[str, dict],
    fallbacks: dict[str, dict],
) -> list[str]:
    """Fill only missing float shares from bounded cached fundamentals."""
    used: list[str] = []
    for row in scored:
        symbol = row["symbol"]
        quote = dict(quotes.get(symbol) or {})
        shares = quote.get("float_shares")
        if isinstance(shares, (int, float)) and shares > 0:
            quotes[symbol] = quote
            continue
        fallback = fallbacks.get(symbol)
        if not fallback:
            quotes[symbol] = quote
            continue
        quote.update({
            "float_shares": fallback["float_shares"],
            "fetched_at": fallback["fetched_at"],
            "source": fallback["source"],
            "provider": fallback["source"],
            "cached": True,
            "cache_age_seconds": fallback["cache_age_seconds"],
            "detail_level": "verified-cache",
        })
        if not isinstance(quote.get("market_cap"), (int, float)):
            quote["market_cap"] = fallback["market_cap"]
        quotes[symbol] = quote
        used.append(symbol)
    return used


def _validated_book(book: dict, target: int) -> bool:
    validation = book.get("validation") or {}
    constraints = book.get("constraints") or []
    return bool(
        book.get("available")
        and len(book.get("holdings") or []) == target
        and validation.get("evaluated")
        and all(rule.get("passed") is True for rule in constraints)
    )


def _next_exchange_rebalance(as_of: str) -> dict | None:
    """Project the next signal and execution with the XNYS session calendar."""
    current = pd.Timestamp(as_of).normalize()
    for year in range(current.year, current.year + 4):
        for month in (3, 9):
            start = pd.Timestamp(year=year, month=month, day=1)
            end = start + pd.offsets.MonthEnd(1)
            if end <= current:
                continue
            calendar_end = min(end + pd.Timedelta(days=10), CALENDAR.last_session)
            if calendar_end <= start:
                continue
            sessions = CALENDAR.sessions_in_range(start, calendar_end)
            month_sessions = [session for session in sessions if session.year == year and session.month == month]
            if not month_sessions:
                continue
            signal = month_sessions[-1]
            execution = next((session for session in sessions if session > signal), None)
            if signal > current and execution is not None:
                return {
                    "signalDate": signal.strftime("%Y-%m-%d"),
                    "executionDate": execution.strftime("%Y-%m-%d"),
                }
    return None


def _is_scheduled_signal_session(value: str) -> bool:
    stamp = pd.Timestamp(value).normalize()
    if stamp.month not in (3, 9):
        return False
    month_start = pd.Timestamp(year=stamp.year, month=stamp.month, day=1)
    month_end = month_start + pd.offsets.MonthEnd(1)
    if month_end > CALENDAR.last_session:
        return False
    sessions = CALENDAR.sessions_in_range(month_start, month_end)
    return bool(len(sessions) and sessions[-1].strftime("%Y-%m-%d") == stamp.strftime("%Y-%m-%d"))


def _portfolio_lifecycle(
    candidates: dict[str, dict], previous: dict | None, series_map: dict[str, SymbolSeries],
    *, as_of: str, generated_at: str, signal_rows: list[dict] | None = None,
) -> dict[str, dict]:
    """Freeze active books between scheduled sessions; persist pending events."""
    previous = previous or {}
    sessions = sorted({stamp.strftime("%Y-%m-%d") for series in series_map.values() for stamp in series.frame.index})
    schedule = rebalance_schedule(pd.to_datetime(sessions), frequency="semiannual") if sessions else []
    events = []
    for event in schedule:
        signal = sessions[event["signal_position"]]
        execution = sessions[event["execution_position"]]
        events.append({"signalDate": signal, "executionDate": execution, "kind": event["kind"]})

    def has_execution_prices(book: dict, session: str) -> bool:
        for holding in book.get("holdings") or []:
            item = series_map.get(str(holding.get("ticker") or ""))
            if item is None or pd.Timestamp(session) not in item.frame.index:
                return False
        return bool(book.get("holdings"))

    output = {}
    for universe, target in DATASET_TARGET_HOLDINGS.items():
        old = previous.get(universe) or {}
        old_active = old.get("activePortfolio") or old.get("portfolio") or candidates[universe]
        active = dict(old_active)
        old_meta = dict(active.get("metadata") or {})
        if not old_meta.get("effectiveDate") and _validated_book(active, target):
            # Safe migration for a previously published schema: retain its
            # exact holdings and weights, and mark its dates as inherited.
            prior_as_of = str((old.get("meta") or {}).get("asOf") or as_of)
            old_meta = {
                "eventId": f"{universe}-legacy-{prior_as_of}", "universe": universe,
                "methodologyId": active.get("methodology", {}).get("id", METHODOLOGY_ID),
                "weightingMethod": active.get("methodology", {}).get("weighting_method", WEIGHTING_METHOD_ID),
                "rebalanceFrequency": "semiannual", "formationType": "legacy_migration",
                "signalDate": prior_as_of, "executionDate": prior_as_of,
                "effectiveDate": prior_as_of, "lastRebalanceDate": None,
                "publicationTimestamp": str((old.get("meta") or {}).get("generatedAt") or generated_at),
            }
        pending = old.get("pendingRebalance")
        if pending and not pending.get("executionDate"):
            following = next((session for session in sessions if session > str(pending.get("signalDate") or "")), None)
            if following:
                pending_meta = dict(pending.get("metadata") or {})
                pending_meta.update({"executionDate": following, "effectiveDate": following, "lastRebalanceDate": following})
                pending = {**pending, "executionDate": following, "metadata": pending_meta}
        # Promote only after the next real market session is present and the
        # candidate book passed all published portfolio constraints.
        if (
            pending
            and pending.get("executionDate")
            and as_of >= str(pending.get("executionDate"))
            and has_execution_prices(pending.get("portfolio") or {}, str(pending.get("executionDate")))
        ):
            candidate = pending.get("portfolio") or {}
            if _validated_book(candidate, target):
                active = candidate
                old_meta = dict(pending.get("metadata") or {})
                old_meta["rebalanceHistory"] = [
                    *(old_meta.get("rebalanceHistory") or []),
                    {key: old_meta.get(key) for key in ("eventId", "formationType", "signalDate", "executionDate", "effectiveDate")},
                ]
                pending = None

        if not old_meta.get("effectiveDate"):
            # First deployment: form from the latest valid signal and record
            # this as an initial formation, never as a normal rebalance.
            if _validated_book(candidates[universe], target):
                active = candidates[universe]
                old_meta = {
                    "eventId": f"{universe}-initial-{as_of}", "universe": universe,
                    "methodologyId": METHODOLOGY_ID, "weightingMethod": WEIGHTING_METHOD_ID,
                    "rebalanceFrequency": "semiannual", "formationType": "initial_formation",
                    "signalDate": as_of, "executionDate": as_of, "effectiveDate": as_of,
                    "lastRebalanceDate": None, "publicationTimestamp": generated_at,
                    "rebalanceHistory": [{"eventId": f"{universe}-initial-{as_of}", "formationType": "initial_formation", "signalDate": as_of, "executionDate": as_of, "effectiveDate": as_of}],
                }
        else:
            due = next((event for event in events if event["signalDate"] > str(old_meta.get("signalDate") or "")), None)
            if due and due["signalDate"] == as_of and not pending:
                candidate = candidates[universe]
                if _validated_book(candidate, target):
                    pending = {"eventId": f"{universe}-rebalance-{due['signalDate']}", **due,
                        "portfolio": candidate, "metadata": {
                            "eventId": f"{universe}-rebalance-{due['signalDate']}", "universe": universe,
                            "methodologyId": METHODOLOGY_ID, "weightingMethod": WEIGHTING_METHOD_ID,
                            "rebalanceFrequency": "semiannual", "formationType": "scheduled_rebalance",
                            "signalDate": due["signalDate"], "executionDate": due["executionDate"],
                            "effectiveDate": due["executionDate"], "lastRebalanceDate": due["executionDate"],
                            "publicationTimestamp": generated_at,
                        }}
            if not pending:
                signal = pd.Timestamp(as_of)
                # A signal is queued only when the exchange calendar confirms
                # this is the final actual trading session of March/September.
                # The next publication supplies the following real session.
                if _is_scheduled_signal_session(as_of) and as_of == sessions[-1]:
                    candidate = candidates[universe]
                    if _validated_book(candidate, target):
                        pending = {"eventId": f"{universe}-rebalance-{as_of}", "kind": "scheduled",
                            "signalDate": as_of, "executionDate": None, "portfolio": candidate,
                            "metadata": {"eventId": f"{universe}-rebalance-{as_of}", "universe": universe,
                                "methodologyId": METHODOLOGY_ID, "weightingMethod": WEIGHTING_METHOD_ID,
                                "rebalanceFrequency": "semiannual", "formationType": "scheduled_rebalance",
                                "signalDate": as_of, "executionDate": None, "effectiveDate": None,
                                "lastRebalanceDate": None, "publicationTimestamp": generated_at}}

        next_event = _next_exchange_rebalance(as_of)
        active["metadata"] = {
            **old_meta,
            "nextScheduledSignalDate": next_event["signalDate"] if next_event else None,
            "nextScheduledRebalanceDate": next_event["executionDate"] if next_event else None,
        }
        active_tickers = {holding.get("ticker") for holding in active.get("holdings") or []}
        candidate_tickers = {holding.get("ticker") for holding in candidates[universe].get("holdings") or []}
        live_rows = [{
            **row,
            "activePortfolioStatus": (
                "currently_held" if row.get("ticker") in active_tickers
                else "potential_new_entry" if row.get("ticker") in candidate_tickers
                else "outside_active_portfolio"
            ),
        } for row in (signal_rows or [])]
        output[universe] = {
            "activePortfolio": active,
            "liveSignals": {"asOf": as_of, "publicationTimestamp": generated_at, "rows": live_rows},
            "pendingRebalance": pending,
        }
    return output


# --------------------------------------------------------------------------- #
# Data loading                                                                #
# --------------------------------------------------------------------------- #

def load_series(
    symbols: list[str],
    years: int | None = None,
    progress=None,
) -> tuple[dict[str, SeriesResult], list[dict]]:
    """Fetch daily series in bounded batches with partial-result recovery."""
    years = years or settings.history_years
    symbols = list(dict.fromkeys(symbols))
    chain = registry.chain()
    primary_id = chain[0]
    primary = registry.adapter(primary_id)

    results: dict[str, SeriesResult] = {}
    failures: list[dict] = []
    total = len(symbols)

    def report(phase: str, completed: int) -> None:
        if progress:
            progress(phase, completed, total)

    report("checking_cache", 0)
    batch_size = max(1, settings.history_batch_size)
    batches = [symbols[index:index + batch_size] for index in range(0, len(symbols), batch_size)]

    if (
        (hasattr(primary, "fetch_many") or hasattr(primary, "fetch_many_with_diagnostics"))
        and batches
    ):
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout, as_completed

        def fetch_batch(batch: list[str]):
            try:
                if hasattr(primary, "fetch_many_with_diagnostics"):
                    values, batch_issues = primary.fetch_many_with_diagnostics(batch, years)
                else:
                    values = primary.fetch_many(batch, years)
                    batch_issues = {}
                return batch, values, batch_issues, None
            except Exception as exc:  # noqa: BLE001 - fallback handles this batch
                return batch, {}, {}, f"{type(exc).__name__}: {exc}"[:200]

        completed = 0
        # A provider call that never returns used to hang this function forever:
        # `as_completed` waited on it, closing the executor waited on it again,
        # and `_WARMING["active"]` therefore stayed true — so the service could
        # never start another warm-up, never published, and answered every
        # request slowly while the stuck thread kept working. Wait a bounded
        # time instead and let the per-symbol pass below recover whatever that
        # batch would have contributed.
        # The budget is per *wave*, not for the whole phase: two workers chewing
        # through six batches need three waves, and a limit sized for one wave
        # would abandon batches that were about to finish. A hung call still
        # costs one wave and nothing more.
        batch_workers = max(1, settings.history_batch_workers)
        batch_waves = max(1, -(-len(batches) // batch_workers))
        batch_budget = max(1.0, float(settings.history_batch_timeout)) * batch_waves
        pool = ThreadPoolExecutor(max_workers=batch_workers)
        try:
            futures = {pool.submit(fetch_batch, batch): batch for batch in batches}
            try:
                for future in as_completed(futures, timeout=batch_budget):
                    batch, batch_results, batch_issues, error = future.result()
                    results.update(batch_results)
                    completed += len(batch)
                    if error:
                        failures.append({
                            "provider": primary_id,
                            "stage": "batch",
                            "error": error,
                            "symbols": len(batch),
                        })
                    for symbol in batch:
                        if symbol in batch_results:
                            continue
                        issue = batch_issues.get(symbol) or {
                            "provider": primary_id,
                            "stage": "batch_validation",
                            "category": "ProviderNoData",
                            "error": "batch response omitted or failed validation",
                        }
                        failures.append({
                            **issue,
                            "symbol": symbol,
                            "stage": "batch_omission",
                        })
                    report("loading_bars", completed)
            except FuturesTimeout:
                for future, batch in futures.items():
                    if future.done():
                        continue
                    completed += len(batch)
                    failures.append({
                        "provider": primary_id,
                        "stage": "batch",
                        "error": f"batch timed out after {batch_budget:.0f}s",
                        "symbols": len(batch),
                    })
                report("loading_bars", completed)
        finally:
            # `wait=False`: a hung provider call must not keep this thread alive.
            pool.shutdown(wait=False, cancel_futures=True)

    missing = [
        symbol
        for symbol in symbols
        if symbol not in results or not results[symbol].adjusted
    ]

    def fetch_one(symbol: str):
        attempts = max(0, settings.retry_attempts)
        last_error = None
        for attempt in range(attempts + 1):
            try:
                return symbol, registry.series(symbol, years), None
            except (ProviderAuthError, ProviderBlocked, ProviderNoData) as exc:
                return symbol, None, ("provider", f"{exc} (tried: {', '.join(registry.chain())})")
            except ProviderError as exc:
                last_error = exc
                if attempt < attempts:
                    time.sleep(settings.retry_base_seconds * (2 ** attempt))
            except Exception as exc:  # noqa: BLE001
                return symbol, None, ("unexpected", f"{type(exc).__name__}: {exc}"[:200])
        return symbol, None, ("provider", f"{last_error} (tried: {', '.join(registry.chain())})")

    if missing:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout, as_completed

        completed = total - len(missing)
        # Same bounded wait as the batch phase: one symbol that never answers
        # must cost one missing symbol, not the whole publication.
        symbol_budget = max(1.0, float(settings.warm_timeout))
        recovery_workers = settings.series_fetch_workers
        if primary_id == "yahoo":
            recovery_workers = min(recovery_workers, settings.yahoo_recovery_workers)
        pool = ThreadPoolExecutor(max_workers=max(1, recovery_workers))
        try:
            futures = {pool.submit(fetch_one, symbol): symbol for symbol in missing}
            try:
                for future in as_completed(futures, timeout=symbol_budget):
                    symbol, resolved, error = future.result()
                    completed += 1
                    report("recovering_symbols", completed)
                    if error:
                        stage, message = error
                        failures.append({"provider": "none", "stage": stage, "symbol": symbol, "error": message})
                        continue
                    try:
                        if not resolved.result.adjusted:
                            raise ProviderNoData(
                                f"only an unadjusted series was available for {symbol}"
                            )
                        results[symbol] = resolved.result
                        failures.append({
                            "provider": resolved.result.source,
                            "stage": "recovery_success",
                            "symbol": symbol,
                            "observations": len(resolved.result.bars),
                            "adjusted_close_complete": resolved.result.adjusted,
                            "cached": resolved.result.cached,
                            "cache_age_seconds": resolved.result.cache_age_seconds,
                            "attempts": [
                                {
                                    "provider": attempt.provider,
                                    "ok": attempt.ok,
                                    "error": attempt.error,
                                    "category": attempt.error_kind,
                                }
                                for attempt in resolved.attempts
                            ],
                        })
                        if resolved.used_backup:
                            failures.append(
                                {
                                    "provider": resolved.result.source,
                                    "stage": "fallback",
                                    "symbol": symbol,
                                    "error": f"primary provider failed; served by {resolved.result.source_label}",
                                }
                            )
                    except ProviderError as exc:
                        failures.append({"provider": "none", "stage": "fetch", "symbol": symbol, "error": str(exc)[:200]})
            except FuturesTimeout:
                for future, symbol in futures.items():
                    if future.done():
                        continue
                    failures.append({
                        "provider": "none",
                        "stage": "symbol",
                        "symbol": symbol,
                        "error": f"timed out after {symbol_budget:.0f}s",
                    })
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    report("bars_ready", len(results))
    return results, failures


def to_symbol_series(result: SeriesResult) -> SymbolSeries | None:
    cleaned, warnings = validate_bars(result.bars, min_rows=1)
    frame = build_frame(cleaned)
    if frame is None or frame.empty:
        return None
    return SymbolSeries(
        symbol=result.symbol,
        frame=frame,
        source=result.source,
        source_label=result.source_label,
        fetched_at=result.fetched_at,
        adjusted=result.adjusted,
        is_backup=result.is_backup,
        cached=result.cached,
        cache_age_seconds=result.cache_age_seconds,
        warnings=[*result.warnings, *warnings],
    )


def load_cached_backtest_series(
    symbols: list[str] | None = None,
    years: int | None = None,
) -> dict[str, SymbolSeries]:
    """Load the historical backtest universe from provider bar caches.

    An on-demand backtest must not turn one Run click into a full universe
    refresh. Recent provider caches are used first; only symbols absent from
    all cache namespaces fall back to the normal bounded loader.
    """
    years = years or settings.history_years
    requested = list(dict.fromkeys(symbols or [*HISTORICAL_BACKTEST_TICKERS, *BENCHMARKS]))
    namespaces = (
        ("yahoo_bars", "yahoo", "Yahoo Finance"),
        ("twelvedata_bars", "twelvedata", "Twelve Data"),
        ("fmp_bars", "fmp", "Financial Modeling Prep"),
        ("stooq_bars", "stooq", "Stooq"),
    )
    series_map: dict[str, SymbolSeries] = {}
    missing = []
    for symbol in requested:
        cached = None
        for namespace, source, source_label in namespaces:
            payload = cache.read_stale(namespace, f"{symbol}:{years}y")
            if payload and payload.get("bars"):
                cached = (payload, source, source_label, namespace, f"{symbol}:{years}y")
                break
        else:
            stale = cache.read_stale("stooq_bars", symbol)
            if stale and stale.get("bars"):
                cached = (stale, "stooq", "Stooq", "stooq_bars", symbol)
        if cached is None:
            missing.append(symbol)
            continue
        payload, source, source_label, namespace, cache_key = cached
        try:
            bars = [NormalizedBar(**row) for row in payload.get("bars", [])]
        except (TypeError, ValueError):
            missing.append(symbol)
            continue
        result = SeriesResult(
            symbol=symbol,
            bars=bars,
            source=(payload.get("source") or source),
            source_label=(payload.get("source_label") or source_label),
            fetched_at=payload.get("fetched_at") or _now(),
            adjusted=bool(payload.get("adjusted")),
            is_backup=False,
            cached=True,
            cache_age_seconds=cache.age_seconds(namespace, cache_key),
        )
        converted = to_symbol_series(result)
        if converted:
            series_map[symbol] = converted
        else:
            missing.append(symbol)

    # Every historical member is a currently listed core name, so a materially
    # older tail than the freshest cached series is stale rather than delisting.
    # Refresh those tails before simulation; the provider loader may return a
    # stale cache after a failed refresh and its warning remains attached.
    latest_strings = [
        series.latest_date
        for series in series_map.values()
        if series.latest_date
    ]
    freshest = max(latest_strings, default="")
    stale_tails = [
        symbol
        for symbol, series in series_map.items()
        if freshest and series.latest_date < freshest
    ]
    refresh = list(dict.fromkeys([*missing, *stale_tails]))
    if refresh:
        results, _ = load_series(refresh, years=years)
        for symbol, result in results.items():
            converted = to_symbol_series(result)
            if converted:
                if freshest and converted.latest_date < freshest:
                    sessions_behind = len(
                        pd.bdate_range(
                            pd.Timestamp(converted.latest_date) + pd.Timedelta(days=1),
                            pd.Timestamp(freshest),
                        )
                    )
                    converted.warnings.append(
                        f"history ends {converted.latest_date}, "
                        f"{sessions_behind} business session(s) behind the freshest cached series"
                    )
                series_map[symbol] = converted
    return series_map


def run_historical_backtest(
    *,
    portfolio: str,
    rebalance_frequency: str,
    start: str,
    end: str,
    initial_capital: float = 10_000.0,
    cashflow_enabled: bool = False,
    cashflow_amount: float = 0.0,
    cashflow_frequency: str = "monthly",
    cashflow_direction: str = "inflow",
) -> dict:
    """Run one requested historical backtest against cache-backed provider bars."""
    series_map = load_cached_backtest_series()
    universe_set = set(HISTORICAL_BACKTEST_TICKERS) & set(series_map)
    sector_by_symbol = {
        symbol: MEMBER_BY_TICKER[symbol].sector
        for symbol in universe_set
        if symbol in MEMBER_BY_TICKER
    }
    options = {
        "universe_symbols": universe_set,
        "rebalance_frequency": rebalance_frequency,
        "start": start,
        "end": end,
        "sector_by_symbol": sector_by_symbol,
        "initial_capital": initial_capital,
        "cashflow_enabled": cashflow_enabled,
        "cashflow_amount": cashflow_amount,
        "cashflow_frequency": cashflow_frequency,
        "cashflow_direction": cashflow_direction,
    }
    size_history.ensure_share_history(universe_set, end=end)
    options["float_cap_lookup"] = size_history.market_cap_lookup(series_map)
    if portfolio == "top20":
        result = run_backtest(series_map, top_n=20, **options)
    else:
        result = run_backtest(series_map, top_n=100, **options)
    return {
        **_backtest_block(result),
        "request": {
            "portfolio": portfolio,
            "rebalanceFrequency": rebalance_frequency,
            "start": start,
            "end": end,
            "initialCapital": initial_capital,
            "cashflowEnabled": cashflow_enabled,
            "cashflowAmount": cashflow_amount,
            "cashflowFrequency": cashflow_frequency,
            "cashflowDirection": cashflow_direction,
        },
    }


# Bumped whenever the shape of priceHistory changes, so a cached detail from an
# older build is rebuilt instead of served with the previous coverage.
HISTORY_VERSION = 2


def _weekly_price_history(series: SymbolSeries, weeks: int | None = 52) -> dict:
    """Weekly chart observations plus the exact prior-session daily move.

    The plotted values remain the weekly adjusted closes. The two metadata
    arrays let the tooltip identify the real session behind each Friday sample
    and calculate that session's daily move without changing the chart series
    or any momentum calculation.

    ``weeks=None`` publishes every week the provider actually returned, so the
    chart can offer long ranges without inventing observations. The available
    depth is whatever the source has: nothing is back-filled or extrapolated.
    """
    frame = series.frame
    weekly = frame["adj"].resample("W-FRI").last().dropna()
    if weeks is not None:
        weekly = weekly.tail(weeks)
    values = []
    dates = []
    observation_dates = []
    daily_changes = []

    for stamp, value in weekly.items():
        position = int(frame.index.searchsorted(stamp, side="right") - 1)
        if position < 0:
            continue
        values.append(round(float(value), 2))
        dates.append(stamp.strftime("%Y-%m-%d"))
        observation_dates.append(frame.index[position].strftime("%Y-%m-%d"))
        if position == 0:
            daily_changes.append(None)
            continue
        current = float(frame["adj"].iloc[position])
        previous = float(frame["adj"].iloc[position - 1])
        change = None if previous <= 0 else round((current / previous - 1) * 100, 2)
        daily_changes.append(change)

    return {
        "values": values,
        "dates": dates,
        "observationDates": observation_dates,
        "dailyChanges": daily_changes,
    }


# --------------------------------------------------------------------------- #
# Payload builders                                                             #
# --------------------------------------------------------------------------- #

def _observed_session_dates(window: pd.Series, stamps: pd.DatetimeIndex) -> list[str]:
    """The real session behind each resampled bucket label."""
    sessions = window.index
    dates: list[str] = []
    for stamp in stamps:
        position = int(sessions.searchsorted(stamp, side="right")) - 1
        dates.append(sessions[max(position, 0)].strftime("%Y-%m-%d"))
    return dates


def _month_ticks(first: pd.Timestamp, last: pd.Timestamp, period: str) -> list[dict]:
    """Calendar month-end markers between ``first`` and ``last``.

    Each tick carries the date it stands for so the client can place it with the
    same date-to-pixel mapping it uses for the series. Nothing is pinned to the
    window edge: a window that opens on the 13th simply has no tick until the
    first month end, instead of squeezing a half month into a full slot.
    """
    ticks: list[dict] = []
    if first >= last:
        return ticks
    for stamp in pd.date_range(start=first, end=last, freq="ME"):
        if period == "1Y":
            label = stamp.strftime("%b")
        elif period == "3Y":
            label = stamp.strftime("%b '%y")
        else:
            label = stamp.strftime("%Y") if stamp.month == 12 else stamp.strftime("%b '%y")
        ticks.append({"date": stamp.strftime("%Y-%m-%d"), "label": label})
    if period == "1Y" and len(ticks) > 12:
        # A window that opens mid-month and closes on a month end spans thirteen
        # month ends, so the first and last tick would both read e.g. "Mar". The
        # leading tick carries its year to keep the axis unambiguous; the rest
        # stay short.
        ticks[0]["label"] = pd.Timestamp(ticks[0]["date"]).strftime("%b '%y")
    return ticks


def _performance_payload(backtest: dict) -> dict:
    """Monthly-sampled cumulative return series per period."""
    if not backtest.get("available"):
        return {}

    strategy: pd.Series = backtest["strategy"]
    benchmarks = backtest["benchmarks"]
    out: dict[str, dict] = {}
    end = strategy.index[-1]

    for period in PERFORMANCE_PERIODS:
        if period == "All":
            start = strategy.index[0]
        else:
            start = max(strategy.index[0], end - pd.DateOffset(years=int(period[:-1])))
        window = strategy.loc[strategy.index >= start]
        if len(window) < 2:
            continue
        monthly = window.resample("ME").last().dropna()
        if monthly.empty or monthly.index[0] != window.index[0]:
            monthly = pd.concat([pd.Series([window.iloc[0]], index=[window.index[0]]), monthly])
        monthly = monthly[~monthly.index.duplicated(keep="last")].sort_index()
        # ``resample`` stamps each bucket with the calendar month end, but the
        # value is the last session inside that month. Plot the session that was
        # actually observed so the time scale matches the data it draws.
        dates = _observed_session_dates(window, monthly.index)

        series = []
        values_by_id = {"strategy": monthly}
        for symbol, values in benchmarks.items():
            aligned = values.reindex(monthly.index, method="ffill").ffill().bfill()
            values_by_id[symbol.lower()] = aligned

        for series_id, name in (("strategy", "Strategy"), ("spy", "SPY"), ("spmo", "SPMO")):
            values = values_by_id.get(series_id)
            if values is None or values.dropna().empty:
                continue
            base = float(values.dropna().iloc[0])
            if series_id == "strategy" and start == strategy.index[0]:
                # The first NAV has already netted the entry transaction cost
                # (100 -> 99.9), but the published cumulative return is measured
                # from the starting capital of 100. Rebasing the chart on 99.9
                # would quietly hand back that cost and leave the Overview label
                # disagreeing with the Backtesting page, so both use 100.
                base = 100.0
            cumulative = [round((float(value) / base - 1) * 100, 1) for value in values.ffill().fillna(base)]
            series.append(
                {
                    "id": series_id,
                    "name": name,
                    "color": SERIES_COLORS[series_id],
                    "end": f"{'+' if cumulative[-1] >= 0 else ''}{cumulative[-1]:.1f}%",
                    "values": cumulative,
                }
            )

        if not series:
            continue

        low = min(min(item["values"]) for item in series)
        high = max(max(item["values"]) for item in series)
        axis = _nice_axis(low, high)
        out[period] = {
            "axis": axis,
            # Every plotted point keeps the session it was sampled on. The window
            # can open mid-month, so the first sample is not a month end.
            "dates": dates,
            # Ticks are calendar month ends with their own dates, not slot
            # numbers: the axis is a time axis, so a month that only contributes
            # half a window must not be stretched onto a whole month's width.
            "ticks": _month_ticks(pd.Timestamp(dates[0]), pd.Timestamp(dates[-1]), period),
            "series": series,
            "points": len(monthly),
        }

    return out


def _nice_axis(low: float, high: float) -> dict:
    span = max(high - low, 5.0)
    padding = span * 0.12
    low -= padding
    high += padding
    raw_step = (high - low) / 5
    magnitude = 10 ** math.floor(math.log10(max(raw_step, 0.1)))
    normalized = raw_step / magnitude
    step = (1 if normalized <= 1 else 2 if normalized <= 2 else 5 if normalized <= 5 else 10) * magnitude
    axis_min = math.floor(low / step) * step
    axis_max = math.ceil(high / step) * step
    if axis_max == axis_min:
        axis_max = axis_min + step
    ticks = []
    value = axis_min
    while value <= axis_max + 1e-9:
        ticks.append(round(value, 4))
        value += step
    return {"min": round(axis_min, 2), "max": round(axis_max, 2), "ticks": ticks}


def _sector_allocation(portfolio: dict) -> list[dict]:
    """Portfolio-weighted sector split (real weights, not symbol counts)."""
    sectors = portfolio.get("sectors") or []
    if not sectors:
        return []
    total = sum(row["value"] for row in sectors) or 1
    exact = [(row, row["value"] / total * 100) for row in sectors]
    rounded = [int(value) for _, value in exact]
    remainder = 100 - sum(rounded)
    order = sorted(range(len(exact)), key=lambda index: exact[index][1] - rounded[index], reverse=True)
    for index in order[:max(0, remainder)]:
        rounded[index] += 1
    return [
        {"name": row["name"], "value": rounded[index], "color": row["color"]}
        for index, (row, _) in enumerate(exact)
    ]


def _exchange_label(raw: str | None) -> str:
    """Yahoo returns exchange codes like "NasdaqGS"; show the venue name instead."""
    if not raw:
        return "US Listed"
    value = str(raw)
    lowered = value.lower()
    if lowered.startswith("nasdaq"):
        return "NASDAQ"
    if lowered in {"nms", "ngm", "ncm"}:
        return "NASDAQ"
    if lowered in {"nyq", "nyse"}:
        return "NYSE"
    if "nyse american" in lowered or lowered.startswith("amex"):
        return "NYSE American"
    if lowered in {"ase", "amx", "nyse american"}:
        return "NYSE American"
    if "nyse" in lowered:
        return "NYSE"
    return value


def _average_daily_dollar_volume(series: SymbolSeries) -> float | None:
    window = series.frame.tail(LIQUIDITY_SESSIONS)
    values = (window["close"] * window["volume"]).dropna()
    if len(values) < LIQUIDITY_SESSIONS:
        return None
    return float(values.mean())


def _assess_universe(
    series_map: dict[str, SymbolSeries],
    quotes: dict[str, dict],
) -> tuple[dict[str, SymbolSeries], list[dict], dict[str, float]]:
    """Apply the current universe rules before any cross-sectional scoring."""
    ticker_series = {symbol: series_map[symbol] for symbol in TICKERS if symbol in series_map}
    if not ticker_series:
        return {}, [], {}
    as_of = max(series.latest_date for series in ticker_series.values())
    eligible: dict[str, SymbolSeries] = {}
    excluded: list[dict] = []
    dollar_volumes: dict[str, float] = {}

    for symbol in TICKERS:
        series = series_map.get(symbol)
        if series is None:
            continue
        member = MEMBER_BY_TICKER[symbol]
        quote = quotes.get(symbol) or {}

        def exclude(reason: str, category: str) -> None:
            excluded.append(
                {
                    "symbol": symbol,
                    "stage": "universe",
                    "category": category,
                    "reason": reason,
                    "rows": series.rows,
                }
            )

        if series.latest_date != as_of:
            exclude(
                f"stale series: latest observation {series.latest_date or 'missing'}, common as-of {as_of}",
                "stale_price_history",
            )
            continue
        if member.instrument_type != "Common stock":
            exclude(
                f"security type {member.instrument_type} is outside the common-stock universe",
                "security_type",
            )
            continue
        quote_type = str(
            quote.get("quote_type")
            or (member.instrument_type.upper().replace(" ", "_") if member.source != "core" else "")
        ).upper()
        if quote_type not in {"EQUITY", "COMMON_STOCK"}:
            exclude("provider did not verify a common-stock security type", "security_type")
            continue
        exchange = _exchange_label(quote.get("exchange") or member.exchange)
        if exchange not in SUPPORTED_EXCHANGES:
            exclude(
                f"exchange {exchange} is outside NYSE, NASDAQ, and NYSE American",
                "exchange",
            )
            continue
        currency = str(quote.get("currency") or ("USD" if member.source != "core" else "")).upper()
        if currency != "USD":
            exclude("provider did not verify USD currency", "currency")
            continue
        if series.rows < MIN_UNIVERSE_OBSERVATIONS:
            exclude(
                f"only {series.rows} observations; universe requires {MIN_UNIVERSE_OBSERVATIONS}",
                "insufficient_history",
            )
            continue
        price = float(series.frame["close"].iloc[-1])
        if not math.isfinite(price) or price < MIN_PRICE:
            exclude(
                f"last close ${price:.2f} is below the ${MIN_PRICE:.0f} minimum",
                "minimum_price",
            )
            continue
        average_dollar_volume = _average_daily_dollar_volume(series)
        if average_dollar_volume is None:
            exclude(
                "insufficient volume history for the 3-month dollar-volume filter",
                "liquidity",
            )
            continue
        if average_dollar_volume < MIN_AVERAGE_DAILY_DOLLAR_VOLUME:
            exclude(
                f"3-month average dollar volume ${average_dollar_volume / 1e6:.2f}M is below $2M",
                "liquidity",
            )
            continue
        eligible[symbol] = series
        dollar_volumes[symbol] = average_dollar_volume
    return eligible, excluded, dollar_volumes


def _stock_rows(scored: list[dict], series_map: dict[str, SymbolSeries], quotes: dict[str, dict]) -> list[dict]:
    rows = []
    for row in scored:
        symbol = row["symbol"]
        series = series_map[symbol]
        quote = quotes.get(symbol, {})
        member = MEMBER_BY_TICKER.get(symbol)
        change, change_percent = compute_daily_change(series)
        volume = float(series.frame["volume"].iloc[-1] or 0)
        rows.append(
            {
                "ticker": symbol,
                "company": (quote.get("name") or (member.name if member else symbol)).replace(", Inc.", "").replace(" Inc.", "").replace(" Corporation", "").replace(" Company", ""),
                "sector": normalize_sector(quote.get("sector") or (member.sector if member else None), symbol),
                "exchange": _exchange_label(quote.get("exchange")),
                "price": row["price"],
                "change": change_percent,
                "changeAbsolute": change,
                "momentum": round(row["momentum_12_1"], 1),
                "momentum3m": round(row["momentum_3m"], 1),
                "momentum6m": round(row["momentum_6m"], 1),
                "momentum12m": round(row["momentum_12m"], 1),
                "momentum1m": round(row["momentum_1m"], 1),
                "volatility": round(row["volatility"], 1),
                "riskAdjusted": round(row["risk_adjusted"], 2),
                "zScore": round(row["z_score"], 2),
                "score": round(row["score"], 4),
                "rank": row["rank"],
                "marketCap": quote.get("market_cap"),
                "marketCapType": "current total company market capitalization",
                "marketCapCurrency": quote.get("currency"),
                "marketCapFetchedAt": quote.get("fetched_at"),
                "floatShares": quote.get("float_shares"),
                "floatMarketCap": row.get("float_market_cap"),
                "averageDailyDollarVolume3m": row.get("average_daily_dollar_volume_3m"),
                "volume": volume,
                "date": row["date"],
                "source": row["source"],
                "sourceLabel": row["source_label"],
                "quoteSource": quote.get("provider") or quote.get("source"),
                "isBackup": row["is_backup"],
                "isCached": row["cached"],
                "cacheAgeSeconds": row["cache_age_seconds"],
                "observations": row["observations"],
                "trend": sparkline_points(series),
                "sparkline12_1": momentum_sparkline(series),
            }
        )
    return rows


def _rank_history(series_map: dict[str, SymbolSeries], months: int = 12) -> dict[str, list[dict]]:
    """Real month-end cross-sectional rank + score for every symbol.

    Each month is scored independently with only the data available at that
    date, then ranked - so the ranking-history chart shows actual historical
    rank movement instead of a straight line to today's rank.
    """
    reference = max(series_map.values(), key=lambda series: series.rows, default=None)
    if reference is None:
        return {}
    month_ends = reference.frame["adj"].resample("ME").last().dropna().index[-months:]

    out: dict[str, list[dict]] = {}
    for stamp in month_ends:
        def lookup(series, target=stamp):
            position = int(series.frame.index.searchsorted(target, side="right") - 1)
            return position if position >= 0 else None

        snapshot = cross_section_at(series_map, lookup, include=historical_universe_eligible)
        if not snapshot:
            continue
        ranked = sorted(snapshot.values(), key=lambda row: row["score"], reverse=True)
        for rank, row in enumerate(ranked, start=1):
            out.setdefault(row["symbol"], []).append(
                {"date": stamp.strftime("%Y-%m-%d"), "rank": rank, "score": row["score"], "universe": len(ranked)}
            )
    return out


def _backtest_block(backtest: dict) -> dict:
    if not backtest.get("available"):
        return {"available": False, "reason": backtest.get("reason", "unavailable")}

    strategy: pd.Series = backtest["strategy"]
    dates = [stamp.strftime("%Y-%m-%d") for stamp in strategy.index]
    benchmarks = backtest["benchmarks"]
    price_benchmarks = backtest.get("price_benchmarks", {})

    def normalized(values: pd.Series) -> list[float]:
        aligned = values.reindex(strategy.index).ffill().bfill()
        base = float(aligned.iloc[0])
        return [round(float(value) / base * 100, 2) for value in aligned]

    drawdown = ((strategy / strategy.cummax()) - 1) * 100
    return {
        "available": True,
        "start": backtest["start"],
        "end": backtest["end"],
        "dates": dates,
        "strategy": [round(float(value), 2) for value in strategy.values],
        "priceStrategy": (
            [round(float(value), 2) for value in backtest["price_strategy"].reindex(strategy.index).values]
            if "price_strategy" in backtest
            else []
        ),
        "spy": normalized(benchmarks["SPY"]) if "SPY" in benchmarks else [],
        "spmo": normalized(benchmarks["SPMO"]) if "SPMO" in benchmarks else [],
        "priceSpy": (
            [round(float(value), 2) for value in price_benchmarks["SPY"].reindex(strategy.index).ffill().values]
            if "SPY" in price_benchmarks
            else []
        ),
        "priceSpmo": (
            [round(float(value), 2) for value in price_benchmarks["SPMO"].reindex(strategy.index).ffill().values]
            if "SPMO" in price_benchmarks
            else []
        ),
        "returnConventions": {
            "totalReturn": "Adjusted closes, dividends reinvested at the adjustment basis",
            "priceReturn": "Split-adjusted closes with cash dividends retained and no reinvestment",
        },
        "drawdown": [round(float(value), 2) for value in drawdown.values],
        "annual": backtest["annual"],
        "metrics": backtest["metrics"],
        "rebalances": len(backtest["holdings_log"]),
        "eventCounts": backtest.get("event_counts"),
        "rebalance_log": backtest["holdings_log"],
        "methodology": backtest.get("methodology"),
        "dividendCoverage": backtest.get("dividend_coverage"),
        "dataQuality": backtest.get("data_quality"),
        "cashflowAccounts": backtest.get("cashflow_accounts"),
        "priceCashflowAccounts": backtest.get("price_cashflow_accounts"),
    }


# --------------------------------------------------------------------------- #
# Publication                                                                  #
# --------------------------------------------------------------------------- #

def _dataset_meta(
    *,
    universe: str,
    as_of: str,
    generated_at: str,
    portfolio: dict,
    backtest: dict,
) -> dict:
    """Provenance for one dataset, so a page can never pass stale data off as current."""
    target = DATASET_TARGET_HOLDINGS[universe]
    holdings = portfolio.get("holdings") or []
    portfolio_ready = bool(portfolio.get("available")) and len(holdings) == target
    backtest_ready = bool(backtest.get("available"))
    if portfolio_ready and backtest_ready:
        status = "success"
    elif portfolio_ready:
        status = "partial"
    else:
        status = "unavailable"
    return {
        "universe": universe,
        "targetHoldings": target,
        "selectedCount": len(holdings),
        "calculationDate": as_of,
        "dataTimestamp": generated_at,
        "runId": f"{universe}@{as_of}#{generated_at}",
        "status": status,
        "portfolioStatus": "ready" if portfolio_ready else str(portfolio.get("status") or "unavailable"),
        "backtestStatus": "success" if backtest_ready else "unavailable",
        "methodology": METHODOLOGY_ID,
        "weightingMethod": (portfolio.get("weighting") or {}).get("method"),
        "marketCapExponent": (portfolio.get("weighting") or {}).get("marketCapExponent"),
        "constraintValidation": _constraint_state(portfolio),
    }


def _constraint_state(portfolio: dict) -> str:
    """One word for the published constraint outcome, never an optimistic guess."""
    constraints = portfolio.get("constraints") or []
    if not constraints:
        return "unavailable"
    if all(row.get("passed") for row in constraints):
        return "passed"
    if any(row.get("status") == "passed" for row in constraints):
        return "failed"
    return "unavailable"


def _refresh_diagnostics(
    *,
    requested_symbols: list[str],
    results: dict[str, SeriesResult],
    series_map: dict[str, SymbolSeries],
    failures: list[dict],
    universe_excluded: list[dict],
    momentum_excluded: list[dict],
    scored: list[dict],
    detail_candidates: list[str],
    quotes: dict[str, dict],
    detail_failures: list[dict],
    cached_fundamental_symbols: list[str],
    portfolios: dict[str, dict],
) -> dict:
    """Explain price, eligibility and portfolio coverage with runtime values."""
    loaded_symbols = [symbol for symbol in requested_symbols if symbol in series_map]
    missing_price_history = [
        symbol for symbol in requested_symbols if symbol not in series_map
    ]
    invalid_adjusted_close = sorted({
        str(failure.get("symbol"))
        for failure in failures
        if failure.get("symbol")
        and (
            "adjusted" in str(failure.get("error") or "").lower()
            or "adjusted_close" in str(failure.get("category") or "").lower()
        )
    } | {
        symbol for symbol, result in results.items()
        if not result.adjusted
    })

    exclusions = [*universe_excluded, *momentum_excluded]
    categories = (
        "stale_price_history",
        "insufficient_history",
        "security_type",
        "exchange",
        "currency",
        "minimum_price",
        "liquidity",
        "invalid_momentum",
        "invalid_adjusted_close",
    )
    eligibility = {
        "excludedByCategory": {
            category: sorted(
                str(row.get("symbol"))
                for row in exclusions
                if row.get("category") == category and row.get("symbol")
            )
            for category in categories
        },
        "excludedTotal": len(exclusions),
    }

    detail_set = set(detail_candidates)
    float_flags = {
        row["symbol"]: (
            isinstance((quotes.get(row["symbol"]) or {}).get("float_shares"), (int, float))
            and quotes[row["symbol"]]["float_shares"] > 0
        )
        for row in scored
    }
    missing_float_shares = [
        symbol for symbol in detail_candidates if not float_flags.get(symbol, False)
    ]
    invalid_float_market_cap = [
        row["symbol"]
        for row in scored
        if float_flags.get(row["symbol"])
        and not (
            isinstance(row.get("float_market_cap"), (int, float))
            and math.isfinite(row["float_market_cap"])
            and row["float_market_cap"] > 0
        )
    ]
    ranked = rank_for_selection(scored)
    portfolio_diagnostics = {}
    for universe, target in DATASET_TARGET_HOLDINGS.items():
        book = portfolios.get(universe) or {}
        holdings = book.get("holdings") or []
        portfolio_diagnostics[universe] = {
            "target": target,
            "available": bool(book.get("available")),
            "scoredCandidates": len(scored),
            "investableCandidates": len(ranked),
            "selectedBeforeWeighting": min(target, len(ranked)),
            "selected": len(holdings),
            "reason": book.get("reason"),
            "excludedNoMarketCap": list(book.get("excluded_no_market_cap") or []),
            "excludedNoScore": list(book.get("excluded_no_score") or []),
            "validation": book.get("validation"),
        }

    return {
        "requested": len(requested_symbols),
        "loaded": len(loaded_symbols),
        "eligible": len(scored),
        "missingPriceHistory": missing_price_history,
        "invalidAdjustedClose": invalid_adjusted_close,
        "insufficientHistory": eligibility["excludedByCategory"]["insufficient_history"],
        "missingFloatShares": missing_float_shares,
        "invalidFloatMarketCap": invalid_float_market_cap,
        "eligibility": eligibility,
        "fundamentals": {
            "candidates": len(detail_candidates),
            "verifiedFloatShares": sum(
                1 for symbol in detail_set if float_flags.get(symbol, False)
            ),
            "verifiedFloatMarketCaps": sum(
                1 for row in scored
                if row["symbol"] in detail_set
                and isinstance(row.get("float_market_cap"), (int, float))
                and row["float_market_cap"] > 0
            ),
            "verifiedCacheFallbacks": list(cached_fundamental_symbols),
            "providerFailures": detail_failures,
        },
        "portfolio": portfolio_diagnostics,
        "priceRecovery": failures,
        "asOf": max(
            (series.latest_date for series in series_map.values() if series.latest_date),
            default=None,
        ),
    }


def _momentum_row(row: dict) -> dict:
    """One Top Momentum row from a ranked stock row (tolerant of partial rows)."""
    price = row.get("price")
    score = row.get("score")
    return {
        "rank": row.get("rank"),
        "ticker": row.get("ticker"),
        "price": f"${price:.2f}" if isinstance(price, (int, float)) else "—",
        "score": f"{score:.2f}" if isinstance(score, (int, float)) else "—",
        "trend": row.get("trend") or [],
    }


def build_universe_datasets(payload: dict, performances: dict[str, dict] | None = None) -> dict:
    """Split the publication into one self-contained dataset per universe.

    Overview, Screener and Portfolio all read a single dataset, so a Top 20
    view can never borrow a Top 100 ranking row, sector weight or chart. The
    stock rows come from the portfolio's own selection: the screener list, the
    holdings table and the exports therefore describe exactly the same names.
    """
    performances = performances or {}
    stocks = payload.get("stocks") or []
    portfolios = payload.get("portfolios") or {}
    backtests = payload.get("backtest") or {}
    meta = payload.get("meta") or {}
    as_of = str(meta.get("as_of") or "")
    generated_at = str(meta.get("generated_at") or "")
    scanned_count = (payload.get("universe") or {}).get("scanned") or 0
    eligible_count = (payload.get("universe") or {}).get("eligible") or len(stocks)

    datasets: dict[str, dict] = {}
    for universe in DATASET_UNIVERSES:
        target = DATASET_TARGET_HOLDINGS[universe]
        portfolio = portfolios.get(universe) or {"available": False, "holdings": []}
        backtest = backtests.get(universe) or {"available": False}
        selected = {
            holding.get("ticker")
            for holding in portfolio.get("holdings") or []
            if holding.get("ticker")
        }
        if selected:
            holding_order = {
                holding.get("ticker"): index
                for index, holding in enumerate(portfolio.get("holdings") or [])
            }
            rows = sorted(
                [row for row in stocks if row.get("ticker") in selected],
                key=lambda row: holding_order.get(row.get("ticker"), len(holding_order)),
            )
        else:
            rows = stocks[:target]
        portfolio_summary = portfolio.get("summary") or {}
        portfolio_count = portfolio_summary.get("totalHoldings") or len(portfolio.get("holdings") or [])
        datasets[universe] = {
            "universe": universe,
            "meta": _dataset_meta(
                universe=universe,
                as_of=as_of,
                generated_at=generated_at,
                portfolio=portfolio,
                backtest=backtest,
            ),
            # The selection is published by ticker, in rank order. The ranked
            # rows themselves live once in ``stocks``: a second copy could drift
            # from the Screener table it is supposed to describe.
            "stockTickers": [row["ticker"] for row in rows],
            "portfolio": portfolio,
            "overview": {
                "snapshot": {
                    "asOfDate": _label_date(as_of) if as_of else "",
                    "asOf": as_of,
                    "scannedStocks": f"{scanned_count:,}",
                    "eligibleStocks": f"{eligible_count:,}",
                    "portfolioStocks": f"{portfolio_count:,}" if portfolio_count else "—",
                },
                "topMomentum": [_momentum_row(row) for row in rows[:5]],
                "sectorAllocation": _sector_allocation(portfolio),
                "performance": performances.get(universe, {}),
            },
        }
    return datasets


def _carry_active_portfolio_rows(
    stocks: list[dict],
    portfolios: dict[str, dict],
    previous_publication: dict | None,
) -> list[dict]:
    """Keep verified display rows for retained holdings outside today's screen.

    The semiannual lifecycle intentionally retains an active holding even if
    one daily screen excludes it. The dataset still needs that row so its
    portfolio, screener and exports describe the same book. Carried rows are
    marked portfolio-only and retain their original market date and source.
    """
    indexed = {row.get("ticker"): row for row in stocks if row.get("ticker")}
    previous_rows = {
        row.get("ticker"): row
        for row in (previous_publication or {}).get("stocks", [])
        if row.get("ticker")
    }
    carried: list[dict] = []
    carried_tickers: set[str] = set()
    for book in portfolios.values():
        for holding in book.get("holdings") or []:
            ticker = holding.get("ticker")
            if not ticker or ticker in indexed or ticker in carried_tickers:
                continue
            previous = previous_rows.get(ticker)
            if not previous:
                continue
            row = {
                **previous,
                "portfolioOnly": True,
                "universeEligible": False,
                "activePortfolioStatus": "currently_held",
            }
            carried.append(row)
            carried_tickers.add(ticker)
            indexed[ticker] = row
    return [*stocks, *carried]


def build_publication(force: bool = False, progress=None, previous_publication: dict | None = None) -> dict:
    """Assemble the full dashboard payload (cached on disk)."""
    ttl = 0 if force else settings.ttl_snapshot
    if not force:
        cached = cache.read("publication", "snapshot", ttl)
        if publication_is_current(cached):
            return cached

    with _BUILD_LOCK:
        if not force:
            cached = cache.read("publication", "snapshot", ttl)
            if publication_is_current(cached):
                return cached

        started = _now()
        build_started = time.perf_counter()
        previous_publication = previous_publication or cache.read_stale("publication", "snapshot")
        seed_publication = None
        try:
            seeded = json.loads(SEED_PATH.read_text())
            seed_publication = seeded.get("value", seeded)
        except (OSError, json.JSONDecodeError):
            pass
        previous_publication = previous_publication or seed_publication
        fundamental_fallbacks = _verified_fundamental_fallbacks(
            [previous_publication, seed_publication]
        )
        symbols = list(TICKERS) + list(BENCHMARKS)
        if progress:
            progress("loading_bars", 0, len(symbols))
        results, failures = load_series(symbols, progress=progress)

        series_map: dict[str, SymbolSeries] = {}
        for symbol, result in results.items():
            converted = to_symbol_series(result)
            if converted:
                series_map[symbol] = converted

        loaded_tickers = [symbol for symbol in TICKERS if symbol in series_map]
        if progress:
            progress("loading_quotes", 0, len(loaded_tickers))
        quotes = registry.quotes(
            loaded_tickers,
            progress=(lambda completed: progress("loading_quotes", completed, len(loaded_tickers))) if progress else None,
        )
        if progress:
            progress("loading_quotes", len(quotes), len(loaded_tickers))
        if progress:
            progress("scoring", len(quotes), len(loaded_tickers))
        universe_map, universe_excluded, dollar_volumes = _assess_universe(series_map, quotes)
        scored, momentum_excluded = compute_snapshot(universe_map)
        for row in momentum_excluded:
            row["stage"] = "momentum"
            reason = str(row.get("reason") or "").lower()
            if "adjusted close" in reason:
                row["category"] = "invalid_adjusted_close"
            elif "observation" in reason or "12-1 window" in reason:
                row["category"] = "insufficient_history"
            else:
                row["category"] = "invalid_momentum"
        excluded = [*universe_excluded, *momentum_excluded]

        # Fast quote data supplies display metadata. Full float-share data is
        # fetched only for the best portfolio candidates, avoiding hundreds of
        # unnecessary .info requests on every scan.
        for row in scored:
            quote = quotes.get(row["symbol"], {})
            row["market_cap"] = quote.get("market_cap")
            row["average_daily_dollar_volume_3m"] = dollar_volumes.get(row["symbol"])
            row["company"] = quote.get("name") or row["symbol"]
            row["sector"] = normalize_sector(quote.get("sector"), row["symbol"])

        # Float shares are only needed for names that could enter a book. The
        # candidates run deeper than the largest published count (100) because a
        # name without verified float shares is skipped for investability rather
        # than substituted, so the walk must be able to reach rank 100 with margin.
        detail_candidates = [row["symbol"] for row in scored[:150]]
        if progress:
            progress("loading_fundamentals", 0, len(detail_candidates))
        detailed_quotes, fundamental_failures = registry.detailed_quotes_with_diagnostics(
            detail_candidates,
            progress=(lambda completed: progress("loading_fundamentals", completed, len(detail_candidates))) if progress else None,
        )
        missing_current_fundamentals = [
            symbol
            for symbol in detail_candidates
            if not (
                isinstance((detailed_quotes.get(symbol) or {}).get("float_shares"), (int, float))
                and detailed_quotes[symbol]["float_shares"] > 0
            )
        ]
        for symbol, detail in detailed_quotes.items():
            quote = dict(quotes.get(symbol) or {})
            quote.update({key: value for key, value in detail.items() if value is not None})
            quotes[symbol] = quote
        cached_fundamental_symbols = _merge_verified_fundamentals(
            scored,
            quotes,
            fundamental_fallbacks,
        )
        if progress:
            progress("loading_fundamentals", len(detail_candidates), len(detail_candidates))
        for row in scored:
            quote = quotes.get(row["symbol"], {})
            float_shares = quote.get("float_shares")
            row["market_cap"] = quote.get("market_cap")
            row["float_market_cap"] = (
                float(float_shares) * row["price"]
                if isinstance(float_shares, (int, float)) and float_shares > 0
                else None
            )
            row["company"] = quote.get("name") or row["company"]
            row["sector"] = normalize_sector(quote.get("sector"), row["symbol"])

        stocks = _stock_rows(scored, series_map, quotes)
        benchmark_map = {symbol: series_map[symbol] for symbol in BENCHMARKS if symbol in series_map}
        backtest_map = {**{symbol: series_map[symbol] for symbol in TICKERS if symbol in series_map}, **benchmark_map}

        backtest_universe = set(HISTORICAL_BACKTEST_TICKERS) & set(universe_map)
        backtest_sectors = {
            symbol: MEMBER_BY_TICKER[symbol].sector
            for symbol in backtest_universe
            if symbol in MEMBER_BY_TICKER
        }
        # Every rebalance is sized from the share count that was in effect on
        # its signal date, so the published book is the weighted portfolio the
        # Portfolio page describes rather than an equal-weight research proxy.
        if progress:
            progress("loading_share_history", 0, len(backtest_universe))
        series_end = max(
            (series.latest_date for series in backtest_map.values() if series.latest_date),
            default="",
        )
        size_history.ensure_share_history(
            backtest_universe,
            end=series_end,
            progress=(
                (lambda completed, total: progress("loading_share_history", completed, total))
                if progress
                else None
            ),
        )
        float_cap_lookup = size_history.market_cap_lookup(backtest_map)
        top100 = run_backtest(
            backtest_map,
            top_n=100,
            universe_symbols=backtest_universe,
            sector_by_symbol=backtest_sectors,
            float_cap_lookup=float_cap_lookup,
            initial_capital=10_000,
            cashflow_enabled=True,
            cashflow_amount=1_000,
            cashflow_frequency="monthly",
            cashflow_direction="inflow",
        )
        top20 = run_backtest(
            backtest_map,
            top_n=20,
            universe_symbols=backtest_universe,
            sector_by_symbol=backtest_sectors,
            float_cap_lookup=float_cap_lookup,
            initial_capital=10_000,
            cashflow_enabled=True,
            cashflow_amount=1_000,
            cashflow_frequency="monthly",
            cashflow_direction="inflow",
        )
        backtest_schedules = {
            "top100": {"semiannual": top100},
            "top20": {"semiannual": top20},
        }
        for portfolio_id, selection in (
            ("top100", {"top_n": 100}),
            ("top20", {"top_n": 20}),
        ):
            for frequency in REBALANCE_FREQUENCIES:
                if frequency == "semiannual":
                    continue
                backtest_schedules[portfolio_id][frequency] = run_backtest(
                    backtest_map,
                    universe_symbols=backtest_universe,
                    sector_by_symbol=backtest_sectors,
                    rebalance_frequency=frequency,
                    start=top100["start"],
                    end=top100["end"],
                    float_cap_lookup=float_cap_lookup,
                    initial_capital=10_000,
                    cashflow_enabled=True,
                    cashflow_amount=1_000,
                    cashflow_frequency="monthly",
                    cashflow_direction="inflow",
                    **selection,
                )

        portfolios = {
            portfolio_id: build_portfolio(scored, target_holdings=target_holdings)
            for portfolio_id, target_holdings in (("top100", 100), ("top20", 20))
        }
        diagnostics = _refresh_diagnostics(
            requested_symbols=list(TICKERS),
            results=results,
            series_map=series_map,
            failures=failures,
            universe_excluded=universe_excluded,
            momentum_excluded=momentum_excluded,
            scored=scored,
            detail_candidates=detail_candidates,
            quotes=quotes,
            detail_failures=fundamental_failures,
            cached_fundamental_symbols=cached_fundamental_symbols,
            portfolios=portfolios,
        )
        portfolio = portfolios["top100"]
        portfolio_tickers = {
            holding["ticker"]
            for book in portfolios.values()
            for holding in book.get("holdings", [])
        }
        portfolio_cached_fundamentals = sorted(
            set(cached_fundamental_symbols) & portfolio_tickers
        )
        for book in portfolios.values():
            book_tickers = {holding["ticker"] for holding in book.get("holdings", [])}
            cached_book_symbols = sorted(set(cached_fundamental_symbols) & book_tickers)
            book["fundamentals"] = {
                "state": "cached" if cached_book_symbols else "fresh",
                "fallbackCount": len(cached_book_symbols),
                "fallbackSymbols": cached_book_symbols,
                "note": (
                    "Verified cached float-share metadata was reused for these holdings."
                    if cached_book_symbols
                    else "All holding fundamentals came from the current provider response."
                ),
            }

        # Month-end cross-sectional ranks, cached for the stock detail page.
        rank_history = _rank_history(universe_map)
        cache.write("derived", "rank_history", rank_history)

        latest_dates = [row["date"] for row in stocks] or [series.latest_date for series in series_map.values()]
        as_of = max(latest_dates) if latest_dates else market_state()["session_date"]
        clock = market_state()

        sources = {}
        for row in stocks:
            sources[row["source"]] = sources.get(row["source"], 0) + 1
        backup_rows = sum(1 for row in stocks if row["isBackup"])
        backups_used = [row["ticker"] for row in stocks if row["isBackup"]]
        symbol_failures = [
            failure["symbol"] for failure in failures
            if failure.get("symbol") and failure.get("stage") in {"fetch", "provider", "symbol"}
        ]
        scanned_count = sum(1 for symbol in TICKERS if symbol in series_map)
        cached_count = sum(1 for symbol in TICKERS if symbol in series_map and series_map[symbol].cached)
        fresh_count = max(0, scanned_count - cached_count)
        # "Degraded" means the screen is running on backup data or not at all;
        # a single unavailable symbol is reported separately.
        degraded = backup_rows > 0 or not stocks
        # A failed batch that was fully recovered ticker-by-ticker is not an
        # incomplete dataset. Keep the diagnostic in ``failures`` but publish
        # only when every required universe series is actually present.
        partial = bool(symbol_failures)
        if not stocks:
            cache_state = "empty"
        elif partial:
            cache_state = "partial"
        elif cached_count == scanned_count and cached_count:
            cache_state = "cached"
        else:
            cache_state = "fresh"

        active_chain = registry.chain()
        configured_primary = settings.provider_chain[0] if settings.provider_chain else "yahoo"
        primary_unavailable = configured_primary not in active_chain
        primary_label = (
            registry.adapter(configured_primary).label if registry.adapter(configured_primary) else configured_primary
        )

        warnings: list[str] = []
        if primary_unavailable:
            warnings.append(f"Primary provider {primary_label} is unavailable; serving {registry.adapter(active_chain[0]).label}.")
        if backup_rows:
            warnings.append(f"{backup_rows} symbol(s) served by a backup provider: {', '.join(backups_used[:8])}")
        if excluded:
            warnings.append(f"{len(excluded)} symbol(s) excluded by universe or momentum eligibility")
        if symbol_failures and not degraded:
            warnings.append(
                f"{len(symbol_failures)} symbol(s) unavailable from every provider: {', '.join(sorted(symbol_failures)[:8])}"
            )
        if portfolio_cached_fundamentals:
            warnings.append(
                f"{len(portfolio_cached_fundamentals)} holding(s) reused verified cached float-share metadata"
            )
        if missing_current_fundamentals:
            warnings.append(
                f"{len(missing_current_fundamentals)} current float-share request(s) unavailable"
            )

        macro = load_cpi(start=datetime(2017, 1, 1).date())
        if not macro.get("available"):
            warnings.append(
                "Official CPI-U data unavailable; inflation-adjusted backtests are disabled"
            )

        payload = {
            "meta": {
                "generated_at": started,
                "as_of": as_of,
                "as_of_label": _label_date(as_of),
                "data_provider": registry.adapter(active_chain[0]).label,
                "data_provider_id": active_chain[0],
                "provider_chain": active_chain,
                "configured_chain": list(settings.provider_chain),
                "primary_configured": configured_primary,
                "primary_configured_label": primary_label,
                "primary_unavailable": primary_unavailable,
                "is_backup": backup_rows > 0,
                "backup_symbols": backups_used,
                "connection_status": "connected" if stocks else "error",
                "market_state": clock["state"],
                "timeliness": clock["timeliness"],
                "timeliness_note": clock["timeliness_note"],
                "new_york_time": clock["new_york_time"],
                "degraded": degraded,
                "warnings": warnings,
                "history_years": settings.history_years,
                "universe_version": UNIVERSE_VERSION,
                "publication_version": PUBLICATION_VERSION,
                "methodology": {
                    "id": METHODOLOGY_ID,
                    "selection": "Momentum Score, descending (score, risk-adjusted, ticker)",
                    "weighting_method": WEIGHTING_METHOD_ID,
                    "weighting": (
                        "score x (float-adjusted market cap / median float-adjusted market cap) "
                        f"^ {MARKET_CAP_EXPONENT:g}"
                    ),
                    "market_cap_exponent": MARKET_CAP_EXPONENT,
                    "single_name_cap_pct": SINGLE_NAME_CAP,
                    "sector_cap_pct": SECTOR_CAP,
                    "sector_cap_scope": "canonical sector groups",
                    "momentum_window": "P(t-21) / P(t-252) - 1",
                    "volatility_window": (
                        "sample std-dev (ddof=1) of 231 daily returns over the 232 adjusted "
                        "closes t-252 through t-21"
                    ),
                    "historical_weighting": (
                        "score-size-proxy: point-in-time outstanding-share market cap; "
                        "historical float shares unavailable"
                    ),
                    "cashflow_accounting": (
                        "strategy and benchmarks hold fractional total-return units; flows "
                        "execute after the daily return at the close"
                    ),
                    "time_weighted_return": (
                        "linked underlying NAV return, independent of external cash flows"
                    ),
                    "money_weighted_return": "XIRR of actual dated investor cash flows",
                },
                "dataset_universes": list(DATASET_UNIVERSES),
                "default_dataset_universe": DATASET_UNIVERSES[0],
                "cache_state": cache_state,
                "refresh_in_progress": False,
                "scan_duration_seconds": round(time.perf_counter() - build_started, 1),
                "portfolio_fundamentals_state": portfolio["fundamentals"]["state"],
                "portfolio_fundamentals_cached_count": portfolio["fundamentals"]["fallbackCount"],
                "portfolio_fundamentals_refresh_failures": len(missing_current_fundamentals),
                "providers": registry.status(),
            },
            "universe": {
                "requested": len(TICKERS),
                "loaded": scanned_count,
                "scanned": scanned_count,
                "fresh": fresh_count,
                "cached": cached_count,
                "partial": partial,
                "eligible": len(stocks),
                "universe_eligible": len(universe_map),
                "momentum_eligible": len(stocks),
                "excluded": excluded,
                "failures": failures,
                "unavailable": sorted(symbol_failures),
                "source": "108 audited core symbols plus 92 sector-balanced additions from the approved S&P MidCap 400 candidate pool",
                "min_universe_observations": MIN_UNIVERSE_OBSERVATIONS,
                "min_momentum_observations": MIN_OBSERVATIONS,
                "filters": {
                    "exchanges": sorted(SUPPORTED_EXCHANGES),
                    "security_types": ["Common stock"],
                    "currency": "USD",
                    "minimum_price": MIN_PRICE,
                    "minimum_average_daily_dollar_volume_3m": MIN_AVERAGE_DAILY_DOLLAR_VOLUME,
                    "liquidity_sessions": LIQUIDITY_SESSIONS,
                },
            },
            "stocks": stocks,
            "overview": {},
            "portfolio": portfolio,
            "portfolios": portfolios,
            "backtest": {
                "top100": _backtest_block(top100),
                "top20": _backtest_block(top20),
            },
            "backtestSchedules": {
                portfolio_id: {
                    frequency: _backtest_block(block)
                    for frequency, block in frequency_blocks.items()
                }
                for portfolio_id, frequency_blocks in backtest_schedules.items()
            },
            "macro": {"cpi": macro},
            "providers": {
                "status": registry.status(),
                "configured_keys": settings.keys_present(),
            },
            "diagnostics": diagnostics,
        }

        previous_datasets = (previous_publication or {}).get("datasets") or {}
        lifecycle = _portfolio_lifecycle(
            portfolios,
            previous_datasets,
            series_map,
            as_of=as_of,
            generated_at=started,
            signal_rows=stocks,
        )
        # The compatibility field remains an alias for the active book. Daily
        # rankings are explicitly published separately and cannot replace it.
        portfolios = {key: lifecycle[key]["activePortfolio"] for key in DATASET_UNIVERSES}
        for universe in DATASET_UNIVERSES:
            candidate_diagnostics = dict(diagnostics["portfolio"][universe])
            active = portfolios[universe]
            diagnostics["portfolio"][universe] = {
                **candidate_diagnostics,
                "available": bool(active.get("available")),
                "selected": len(active.get("holdings") or []),
                "reason": active.get("reason"),
                "validation": active.get("validation"),
                "candidate": candidate_diagnostics,
            }
        payload["portfolios"] = portfolios
        payload["portfolio"] = portfolios["top100"]
        payload["portfolioStates"] = lifecycle
        stocks = _carry_active_portfolio_rows(stocks, portfolios, previous_publication)
        payload["stocks"] = stocks

        # One dataset per universe, then the legacy top-level sections mirror the
        # Top 100 dataset so older cached clients stay self-consistent.
        datasets = build_universe_datasets(
            payload,
            performances={
                "top100": _performance_payload(top100),
                "top20": _performance_payload(top20),
            },
        )
        payload["datasets"] = datasets
        for universe in DATASET_UNIVERSES:
            payload["datasets"][universe]["activePortfolio"] = lifecycle[universe]["activePortfolio"]
            payload["datasets"][universe]["liveSignals"] = lifecycle[universe]["liveSignals"]
            payload["datasets"][universe]["pendingRebalance"] = lifecycle[universe]["pendingRebalance"]
        payload["overview"] = datasets["top100"]["overview"]

        cache.write("publication", "snapshot", payload)
        return payload


def snapshot_age_seconds() -> float | None:
    stored = cache.stored_at("publication", "snapshot")
    return None if stored is None else round(datetime.now(timezone.utc).timestamp() - stored, 1)


# --------------------------------------------------------------------------- #
# Per-symbol detail                                                            #
# --------------------------------------------------------------------------- #

def build_stock_detail(ticker: str) -> dict | None:
    ticker = ticker.upper()
    if ticker not in MEMBER_BY_TICKER and ticker not in BENCHMARKS:
        return None

    publication = cache.read("publication", "snapshot", ttl=-1)
    if not publication and SEED_PATH.exists():
        try:
            seeded = json.loads(SEED_PATH.read_text())
            candidate = seeded.get("value", seeded)
            if (
                candidate.get("meta", {}).get("universe_version") == UNIVERSE_VERSION
                and candidate.get("stocks")
            ):
                publication = candidate
        except (OSError, json.JSONDecodeError):
            publication = None
    if not publication:
        return None
    stock = next((row for row in publication["stocks"] if row["ticker"] == ticker), None)
    if stock is None:
        return None

    # A detail is only valid for the exact publication that produced it, so a
    # manual refresh never leaves a stale exchange label or price behind.
    publication_stamp = publication["meta"]["generated_at"]
    cached = cache.read("detail", ticker, settings.ttl_snapshot)
    cached_history = (cached or {}).get("priceHistory") or {}
    cached_values = cached_history.get("values") or []
    has_tooltip_history = (
        len(cached_history.get("observationDates") or []) == len(cached_values)
        and len(cached_history.get("dailyChanges") or []) == len(cached_values)
    )
    if (
        cached
        and cached.get("_snapshot") == publication_stamp
        and cached.get("_history_version") == HISTORY_VERSION
        and has_tooltip_history
    ):
        return cached

    results, _ = load_series([ticker])
    result = results.get(ticker)
    if result is None:
        return None
    series = to_symbol_series(result)
    if series is None:
        return None

    history = monthly_history(series, months=12)
    rank_history = (cache.read("derived", "rank_history", ttl=-1) or {}).get(ticker, [])
    rank_by_date = {point["date"]: point for point in rank_history}

    # Every week the source holds: the page slices it by range, so 10Y and ALL
    # are bounded by real coverage rather than by the default one-year window.
    price_history = _weekly_price_history(series, weeks=None)

    detail = {
        **stock,
        "priceHistory": {
            **price_history,
            "returns": {
                "oneMonth": stock["momentum1m"],
                "threeMonth": stock["momentum3m"],
                "sixMonth": stock["momentum6m"],
                "twelveMonth": stock["momentum12m"],
            },
        },
        "history": [
            {
                "date": point["date"],
                "month": point["month"],
                "momentum": point["momentum_12_1"],
                "rank": rank_by_date.get(point["date"], {}).get("rank"),
                "score": rank_by_date.get(point["date"], {}).get("score"),
            }
            for point in history
        ],
        "_snapshot": publication_stamp,
        "_history_version": HISTORY_VERSION,
        "bars_url": f"/api/bars/{ticker}",
        "observations": series.rows,
        "source": series.source,
        "sourceLabel": series.source_label,
        "isBackup": series.is_backup,
        "fetchedAt": series.fetched_at,
        "warnings": series.warnings,
    }
    cache.write("detail", ticker, detail)
    return detail


def build_bars(ticker: str, days: int = 750) -> dict:
    ticker = ticker.upper()
    results, _ = load_series([ticker])
    result = results.get(ticker)
    if result is None:
        return {"symbol": ticker, "bars": [], "error": "no data"}
    cleaned, warnings = validate_bars(result.bars)
    rows = cleaned[-days:]
    return {
        "symbol": ticker,
        "source": result.source,
        "source_label": result.source_label,
        "fetched_at": result.fetched_at,
        "adjusted": result.adjusted,
        "is_backup": result.is_backup,
        "warnings": warnings,
        "count": len(rows),
        "bars": [bar.serialize() for bar in rows],
    }


def refresh(force: bool = True) -> dict:
    """Rebuild the publication; used by POST /api/refresh and the warm-up task."""
    with _WARM_LOCK:
        payload = build_publication(force=force)
    return {"ok": True, "generated_at": payload["meta"]["generated_at"], "stocks": len(payload["stocks"])}

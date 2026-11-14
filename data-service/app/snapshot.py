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
    run_backtest,
)
from .clock import market_state
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
PUBLICATION_VERSION = "2026-11-14-pit-size-proxy-v13"
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

    if hasattr(primary, "fetch_many") and batches:
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def fetch_batch(batch: list[str]):
            try:
                return batch, primary.fetch_many(batch, years), None
            except Exception as exc:  # noqa: BLE001 - fallback handles this batch
                return batch, {}, f"{type(exc).__name__}: {exc}"[:200]

        completed = 0
        with ThreadPoolExecutor(max_workers=max(1, settings.history_batch_workers)) as pool:
            futures = [pool.submit(fetch_batch, batch) for batch in batches]
            for future in as_completed(futures):
                batch, batch_results, error = future.result()
                results.update(batch_results)
                completed += len(batch)
                if error:
                    failures.append({
                        "provider": primary_id,
                        "stage": "batch",
                        "error": error,
                        "symbols": len(batch),
                    })
                report("loading_bars", completed)

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
        from concurrent.futures import ThreadPoolExecutor

        from concurrent.futures import as_completed

        completed = total - len(missing)
        with ThreadPoolExecutor(max_workers=max(1, settings.series_fetch_workers)) as pool:
            futures = [pool.submit(fetch_one, symbol) for symbol in missing]
            for future in as_completed(futures):
                symbol, resolved, error = future.result()
                completed += 1
                report("recovering_symbols", completed)
                if error:
                    stage, message = error
                    failures.append({"provider": "none", "stage": stage, "symbol": symbol, "error": message})
                    continue
                try:
                    results[symbol] = resolved.result
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
        },
    }


def _weekly_price_history(series: SymbolSeries, weeks: int = 52) -> dict:
    """Weekly chart observations plus the exact prior-session daily move.

    The plotted values remain the trailing weekly adjusted closes. The two
    metadata arrays let the tooltip identify the real session behind each
    Friday sample and calculate that session's daily move without changing the
    chart series or any momentum calculation.
    """
    frame = series.frame
    weekly = frame["adj"].resample("W-FRI").last().dropna().tail(weeks)
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

        def exclude(reason: str) -> None:
            excluded.append(
                {
                    "symbol": symbol,
                    "stage": "universe",
                    "reason": reason,
                    "rows": series.rows,
                }
            )

        if series.latest_date != as_of:
            exclude(f"stale series: latest observation {series.latest_date or 'missing'}, common as-of {as_of}")
            continue
        if member.instrument_type != "Common stock":
            exclude(f"security type {member.instrument_type} is outside the common-stock universe")
            continue
        quote_type = str(
            quote.get("quote_type")
            or (member.instrument_type.upper().replace(" ", "_") if member.source != "core" else "")
        ).upper()
        if quote_type not in {"EQUITY", "COMMON_STOCK"}:
            exclude("provider did not verify a common-stock security type")
            continue
        exchange = _exchange_label(quote.get("exchange") or member.exchange)
        if exchange not in SUPPORTED_EXCHANGES:
            exclude(f"exchange {exchange} is outside NYSE, NASDAQ, and NYSE American")
            continue
        currency = str(quote.get("currency") or ("USD" if member.source != "core" else "")).upper()
        if currency != "USD":
            exclude("provider did not verify USD currency")
            continue
        if series.rows < MIN_UNIVERSE_OBSERVATIONS:
            exclude(
                f"only {series.rows} observations; universe requires {MIN_UNIVERSE_OBSERVATIONS}"
            )
            continue
        price = float(series.frame["close"].iloc[-1])
        if not math.isfinite(price) or price < MIN_PRICE:
            exclude(f"last close ${price:.2f} is below the ${MIN_PRICE:.0f} minimum")
            continue
        average_dollar_volume = _average_daily_dollar_volume(series)
        if average_dollar_volume is None:
            exclude("insufficient volume history for the 3-month dollar-volume filter")
            continue
        if average_dollar_volume < MIN_AVERAGE_DAILY_DOLLAR_VOLUME:
            exclude(
                f"3-month average dollar volume ${average_dollar_volume / 1e6:.2f}M is below $2M"
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
    eligible_count = len(stocks)

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
            rows = [row for row in stocks if row.get("ticker") in selected]
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


def build_publication(force: bool = False, progress=None) -> dict:
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
        previous_publication = cache.read_stale("publication", "snapshot")
        seed_publication = None
        try:
            seeded = json.loads(SEED_PATH.read_text())
            seed_publication = seeded.get("value", seeded)
        except (OSError, json.JSONDecodeError):
            pass
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
        detailed_quotes = registry.detailed_quotes(
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
        )
        top20 = run_backtest(
            backtest_map,
            top_n=20,
            universe_symbols=backtest_universe,
            sector_by_symbol=backtest_sectors,
            float_cap_lookup=float_cap_lookup,
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
                    **selection,
                )

        portfolios = {
            portfolio_id: build_portfolio(scored, target_holdings=target_holdings)
            for portfolio_id, target_holdings in (("top100", 100), ("top20", 20))
        }
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
        symbol_failures = [failure["symbol"] for failure in failures if failure.get("symbol") and failure.get("stage") in {"fetch", "provider"}]
        scanned_count = sum(1 for symbol in TICKERS if symbol in series_map)
        cached_count = sum(1 for symbol in TICKERS if symbol in series_map and series_map[symbol].cached)
        fresh_count = max(0, scanned_count - cached_count)
        # "Degraded" means the screen is running on backup data or not at all;
        # a single unavailable symbol is reported separately.
        degraded = backup_rows > 0 or not stocks
        partial = bool(symbol_failures or failures)
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
        }

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
    if cached and cached.get("_snapshot") == publication_stamp and has_tooltip_history:
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

    price_history = _weekly_price_history(series)

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

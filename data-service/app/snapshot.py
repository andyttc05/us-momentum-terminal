"""Builds everything the terminal displays from verified provider data.

The publication object is the single source of truth for the SPA. It is built
once per cache window and served as static JSON, so the browser never talks to
a data provider and never sees an API key.
"""

from __future__ import annotations

import math
import threading
from datetime import datetime, timezone

import pandas as pd

from . import cache
from .backtest import (
    LIQUIDITY_SESSIONS,
    MIN_AVERAGE_DAILY_DOLLAR_VOLUME,
    MIN_PRICE,
    MIN_UNIVERSE_OBSERVATIONS,
    historical_universe_eligible,
    run_backtest,
)
from .clock import market_state
from .config import settings
from .models import ProviderError, SeriesResult, validate_bars
from .momentum import (
    MIN_OBSERVATIONS,
    SymbolSeries,
    build_frame,
    compute_daily_change,
    compute_snapshot,
    cross_section_at,
    monthly_history,
    sparkline_points,
)
from .portfolio import build_portfolio
from .providers.registry import registry
from .universe import BENCHMARKS, MEMBER_BY_TICKER, TICKERS, normalize_sector

_WARM_LOCK = threading.Lock()
_BUILD_LOCK = threading.Lock()

PERFORMANCE_PERIODS = ("1Y", "3Y", "5Y", "All")
SERIES_COLORS = {"strategy": "#FFC83D", "spy": "#69A5F5", "spmo": "#AA8BF2"}
SUPPORTED_EXCHANGES = {"NYSE", "NASDAQ", "NYSE American"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _label_date(iso: str) -> str:
    try:
        return datetime.strptime(iso[:10], "%Y-%m-%d").strftime("%b %d, %Y").replace(" 0", " ")
    except (ValueError, TypeError):
        return iso


# --------------------------------------------------------------------------- #
# Data loading                                                                #
# --------------------------------------------------------------------------- #

def load_series(symbols: list[str], years: int | None = None) -> tuple[dict[str, SeriesResult], list[dict]]:
    """Fetch daily series for every symbol, primary provider first."""
    years = years or settings.history_years
    chain = registry.chain()
    primary_id = chain[0]
    primary = registry.adapter(primary_id)

    results: dict[str, SeriesResult] = {}
    failures: list[dict] = []

    try:
        if hasattr(primary, "fetch_many"):
            results.update(primary.fetch_many(symbols, years))
    except Exception as exc:  # noqa: BLE001 - a batch failure must not abort the build
        failures.append({"provider": primary_id, "stage": "batch", "error": str(exc)[:200]})

    missing = [symbol for symbol in symbols if symbol not in results]

    def fetch_one(symbol: str):
        try:
            return symbol, registry.series(symbol, years), None
        except ProviderError as exc:
            return symbol, None, ("provider", f"{exc} (tried: {', '.join(registry.chain())})")
        except Exception as exc:  # noqa: BLE001
            return symbol, None, ("unexpected", f"{type(exc).__name__}: {exc}"[:200])

    if missing:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=min(4, settings.max_workers)) as pool:
            fetched = list(pool.map(fetch_one, missing))

    for symbol, resolved, error in (fetched if missing else []):
        if error:
            stage, message = error
            failures.append({"provider": "none", "stage": "fetch", "symbol": symbol, "error": message})
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
        warnings=[*result.warnings, *warnings],
    )


# --------------------------------------------------------------------------- #
# Payload builders                                                             #
# --------------------------------------------------------------------------- #

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

        if period == "1Y":
            labels = [stamp.strftime("%b") for stamp in monthly.index]
        elif period == "3Y":
            labels = [stamp.strftime("%b '%y") for stamp in monthly.index]
        else:
            labels = [stamp.strftime("%Y") if stamp.month == 12 or i == 0 else stamp.strftime("%b '%y") for i, stamp in enumerate(monthly.index)]
        # Blank repeated month labels (a 1Y window can span 13 month-ends) and
        # thin longer windows so the axis never collides.
        seen: set[str] = set()
        deduped = []
        for label in labels:
            if label in seen:
                deduped.append("")
            else:
                seen.add(label)
                deduped.append(label)
        labels = deduped
        max_labels = 12
        if sum(1 for label in labels if label) > max_labels:
            keep = max_labels
            step = max(1, math.ceil(len(labels) / keep))
            labels = [label if index % step == 0 else "" for index, label in enumerate(labels)]
        if labels and not labels[-1]:
            labels[-1] = monthly.index[-1].strftime("%b")

        low = min(min(item["values"]) for item in series)
        high = max(max(item["values"]) for item in series)
        axis = _nice_axis(low, high)
        out[period] = {"axis": axis, "labels": labels, "series": series, "points": len(monthly)}

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
    return [
        {"name": row["name"], "value": round(row["value"] / total * 100), "color": row["color"]}
        for row in sectors
    ]


def _exchange_label(raw: str | None) -> str:
    """Yahoo returns exchange codes like "NasdaqGS"; show the venue name instead."""
    if not raw:
        return "US Listed"
    value = str(raw)
    lowered = value.lower()
    if lowered.startswith("nasdaq"):
        return "NASDAQ"
    if "nyse american" in lowered or lowered.startswith("amex"):
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
        quote_type = str(quote.get("quote_type") or "").upper()
        if quote_type not in {"EQUITY", "COMMON_STOCK"}:
            exclude("provider did not verify a common-stock security type")
            continue
        exchange = _exchange_label(quote.get("exchange"))
        if exchange not in SUPPORTED_EXCHANGES:
            exclude(f"exchange {exchange} is outside NYSE, NASDAQ, and NYSE American")
            continue
        if str(quote.get("currency") or "").upper() != "USD":
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
                "observations": row["observations"],
                "trend": sparkline_points(series),
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
        "spy": normalized(benchmarks["SPY"]) if "SPY" in benchmarks else [],
        "spmo": normalized(benchmarks["SPMO"]) if "SPMO" in benchmarks else [],
        "drawdown": [round(float(value), 2) for value in drawdown.values],
        "annual": backtest["annual"],
        "metrics": backtest["metrics"],
        "rebalances": len(backtest["holdings_log"]),
        "rebalance_log": backtest["holdings_log"],
        "methodology": backtest.get("methodology"),
    }


# --------------------------------------------------------------------------- #
# Publication                                                                  #
# --------------------------------------------------------------------------- #

def build_publication(force: bool = False) -> dict:
    """Assemble the full dashboard payload (cached on disk)."""
    ttl = 0 if force else settings.ttl_snapshot
    if not force:
        cached = cache.read("publication", "snapshot", ttl)
        if cached:
            return cached

    with _BUILD_LOCK:
        if not force:
            cached = cache.read("publication", "snapshot", ttl)
            if cached:
                return cached

        started = _now()
        symbols = list(TICKERS) + list(BENCHMARKS)
        results, failures = load_series(symbols)

        series_map: dict[str, SymbolSeries] = {}
        for symbol, result in results.items():
            converted = to_symbol_series(result)
            if converted:
                series_map[symbol] = converted

        quotes = registry.quotes(list(TICKERS))
        universe_map, universe_excluded, dollar_volumes = _assess_universe(series_map, quotes)
        scored, momentum_excluded = compute_snapshot(universe_map)
        for row in momentum_excluded:
            row["stage"] = "momentum"
        excluded = [*universe_excluded, *momentum_excluded]

        # Attach quote metadata used by the portfolio builder.
        for row in scored:
            quote = quotes.get(row["symbol"], {})
            row["market_cap"] = quote.get("market_cap")
            float_shares = quote.get("float_shares")
            row["float_market_cap"] = (
                float(float_shares) * row["price"]
                if isinstance(float_shares, (int, float)) and float_shares > 0
                else None
            )
            row["average_daily_dollar_volume_3m"] = dollar_volumes.get(row["symbol"])
            row["company"] = quote.get("name") or row["symbol"]
            row["sector"] = normalize_sector(quote.get("sector"), row["symbol"])

        stocks = _stock_rows(scored, series_map, quotes)
        benchmark_map = {symbol: series_map[symbol] for symbol in BENCHMARKS if symbol in series_map}
        backtest_map = {**{symbol: series_map[symbol] for symbol in TICKERS if symbol in series_map}, **benchmark_map}

        backtest_universe = set(universe_map)
        top100 = run_backtest(backtest_map, top_n=100, universe_symbols=backtest_universe)
        top20 = run_backtest(backtest_map, top_fraction=0.2, universe_symbols=backtest_universe)

        portfolio = build_portfolio(scored)

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
        symbol_failures = [failure["symbol"] for failure in failures if failure.get("symbol") and failure.get("stage") == "fetch"]
        # "Degraded" means the screen is running on backup data or not at all;
        # a single unavailable symbol is reported separately.
        degraded = backup_rows > 0 or not stocks

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
                "providers": registry.status(),
            },
            "universe": {
                "requested": len(TICKERS),
                "loaded": sum(1 for symbol in TICKERS if symbol in series_map),
                "scanned": len(TICKERS),
                "eligible": len(stocks),
                "universe_eligible": len(universe_map),
                "momentum_eligible": len(stocks),
                "excluded": excluded,
                "failures": failures,
                "unavailable": sorted(symbol_failures),
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
            "overview": {
                "snapshot": {
                    "asOfDate": _label_date(as_of),
                    "asOf": as_of,
                    "scannedStocks": f"{len(TICKERS):,}",
                    "eligibleStocks": f"{len(stocks):,}",
                    "portfolioStocks": f"{portfolio.get('summary', {}).get('totalHoldings', 0):,}",
                },
                "topMomentum": [
                    {
                        "rank": row["rank"],
                        "ticker": row["ticker"],
                        "price": f"${row['price']:.2f}",
                        "score": f"{row['score']:.2f}",
                        "trend": row["trend"],
                    }
                    for row in stocks[:5]
                ],
                "sectorAllocation": _sector_allocation(portfolio),
                "performance": _performance_payload(top100),
            },
            "portfolio": portfolio,
            "backtest": {
                "top100": _backtest_block(top100),
                "top20": _backtest_block(top20),
            },
            "providers": {
                "status": registry.status(),
                "configured_keys": settings.keys_present(),
            },
        }

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

    publication = build_publication()
    stock = next((row for row in publication["stocks"] if row["ticker"] == ticker), None)
    if stock is None:
        return None

    # A detail is only valid for the exact publication that produced it, so a
    # manual refresh never leaves a stale exchange label or price behind.
    publication_stamp = publication["meta"]["generated_at"]
    cached = cache.read("detail", ticker, settings.ttl_snapshot)
    if cached and cached.get("_snapshot") == publication_stamp:
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

    weekly = series.frame["adj"].resample("W-FRI").last().dropna()
    tail = weekly.tail(52)

    detail = {
        **stock,
        "priceHistory": {
            "values": [round(float(value), 2) for value in tail.values],
            "dates": [stamp.strftime("%Y-%m-%d") for stamp in tail.index],
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

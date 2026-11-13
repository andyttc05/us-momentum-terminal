#!/usr/bin/env python3
"""Compare the three weighting models and audit point-in-time float coverage.

This script answers two questions and refuses to blur them:

1. **Do the three market-cap exponents change today's published book?**
   Yes, and that is computed here from the current cross-section. Selection is
   held fixed, so only the sizing rule moves.
2. **Is the Beta 0.5 production rule historically validated?**
   Only if point-in-time float-adjusted market capitalisation exists for every
   past signal date. It does not: the configured providers return current
   fundamentals, and the local bar cache stores prices, volume, dividends and
   splits only. The historical comparison therefore reports the gap instead of
   substituting today's float caps into past dates, which would be look-ahead.

Run after the publication has been rebuilt:

    PYTHONPATH=data-service .venv-datatest/bin/python data-service/scripts/weighting_comparison.py
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data-service"))

from app.backtest import run_backtest  # noqa: E402
from app.models import NormalizedBar  # noqa: E402
from app.momentum import SymbolSeries, build_frame  # noqa: E402
from app.portfolio import (  # noqa: E402
    MARKET_CAP_EXPONENT,
    build_portfolio,
    canonical_sector,
)
from app.universe import HISTORICAL_BACKTEST_TICKERS, MEMBER_BY_TICKER  # noqa: E402

CACHE = ROOT / "data-service" / "cache"
PUBLICATION = ROOT / "frontend" / "public" / "data" / "publication.json"
OUTPUT = ROOT / "data-service" / "docs" / "weighting_comparison.json"
BETAS = (0.0, MARKET_CAP_EXPONENT, 1.0)

# Sources that do publish historical float/shares, none of which is wired into
# this project. Listed so the gap is auditable rather than hand-waved.
CANDIDATE_PIT_SOURCES = (
    {
        "source": "Financial Modeling Prep historical market capitalisation",
        "fields": "shares outstanding and market cap per date",
        "available_in_project": False,
        "note": "paid tier; the configured FMP key is not used for fundamentals",
    },
    {
        "source": "Sharadar SF1 / SEP (Nasdaq Data Link)",
        "fields": "point-in-time shares outstanding and fundamentals",
        "available_in_project": False,
        "note": "separate paid subscription, not part of the provider chain",
    },
    {
        "source": "CRSP / Compustat via WRDS",
        "fields": "point-in-time shares outstanding and float",
        "available_in_project": False,
        "note": "institutional licence, not redistributable in this repository",
    },
    {
        "source": "Yahoo Finance / Stooq / Twelve Data bar endpoints",
        "fields": "prices, volume, dividends, splits only",
        "available_in_project": True,
        "note": "current float shares only via the quote endpoint; no history",
    },
)


def _load_publication() -> dict | None:
    try:
        payload = json.loads(PUBLICATION.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return payload if payload.get("stocks") else None


def current_cross_section(payload: dict) -> list[dict]:
    """Scored rows with the fields the weighting rule consumes."""
    rows = []
    for stock in payload.get("stocks") or []:
        score = stock.get("score")
        cap = stock.get("floatMarketCap")
        if not isinstance(score, (int, float)) or score <= 0:
            continue
        rows.append(
            {
                "symbol": stock.get("ticker"),
                "company": stock.get("company"),
                "sector": stock.get("sector"),
                "score": float(score),
                "risk_adjusted": stock.get("riskAdjusted"),
                "momentum_12_1": stock.get("momentum"),
                "market_cap": stock.get("marketCap"),
                "float_market_cap": cap if isinstance(cap, (int, float)) and cap > 0 else None,
            }
        )
    return rows


def _concentration(book: dict) -> dict:
    holdings = book.get("holdings") or []
    weights = [row["finalWeight"] for row in holdings]
    if not weights:
        return {"available": False}
    total = sum(weights)
    shares = [value / total for value in weights]
    hhi = sum(value * value for value in shares)
    groups: dict[str, float] = {}
    for row in holdings:
        group = canonical_sector(str(row.get("sector") or "Other"))
        groups[group] = groups.get(group, 0.0) + row["finalWeight"]
    largest = max(holdings, key=lambda row: row["finalWeight"])
    smallest = min(holdings, key=lambda row: row["finalWeight"])
    return {
        "available": True,
        "holdings": len(holdings),
        "totalWeightPct": round(total, 4),
        "largestHolding": {"ticker": largest["ticker"], "weightPct": round(largest["finalWeight"], 4)},
        "smallestHolding": {"ticker": smallest["ticker"], "weightPct": round(smallest["finalWeight"], 4)},
        "largestToSmallestRatio": round(largest["finalWeight"] / smallest["finalWeight"], 3) if smallest["finalWeight"] else None,
        "topTenWeightPct": round(sum(sorted(weights, reverse=True)[:10]), 2),
        "herfindahlIndex": round(hhi, 6),
        "effectiveNames": round(1.0 / hhi, 2),
        "maxSectorGroupWeightPct": round(max(groups.values()), 3),
        "namesAtStockCap": sum(1 for value in weights if value >= 9.0 - 1e-9),
        "constraintsPassed": all(row.get("passed") for row in book.get("constraints") or []),
    }


def current_snapshot_comparison(payload: dict) -> dict:
    rows = current_cross_section(payload)
    result = {"available": bool(rows), "scoredRows": len(rows), "models": {}}
    if not rows:
        result["reason"] = "no scored rows with float-adjusted market caps in the publication"
        return result
    selections = {}
    for beta in BETAS:
        book = build_portfolio(rows, target_holdings=100, market_cap_exponent=beta)
        selections[beta] = [row["ticker"] for row in book.get("holdings") or []]
        result["models"][f"beta_{beta:g}"] = {
            "formula": (
                "momentum score only"
                if beta == 0
                else f"score x (float cap / median float cap) ^ {beta:g}"
            ),
            **_concentration(book),
        }
    result["selectionIdenticalAcrossModels"] = len({tuple(value) for value in selections.values()}) == 1
    return result


def _load_series(symbol: str, years: int = 10) -> SymbolSeries | None:
    for namespace in ("yahoo_bars", "twelvedata_bars", "fmp_bars", "stooq_bars"):
        path = CACHE / namespace / f"{symbol}_{years}y.json"
        if not path.exists():
            continue
        try:
            cached = json.loads(path.read_text())["value"]
            bars = [NormalizedBar(**row) for row in cached.get("bars", [])]
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            continue
        frame = build_frame(bars)
        if frame is None:
            continue
        return SymbolSeries(
            symbol=symbol,
            frame=frame,
            source=cached.get("source", namespace.split("_")[0]),
            source_label="Provider bars",
            fetched_at=cached.get("fetched_at", ""),
            adjusted=bool(cached.get("adjusted")),
            is_backup=False,
        )
    return None


def audit_point_in_time_coverage() -> dict:
    """What historical size data actually exists on disk?"""
    cached_symbols = 0
    for symbol in HISTORICAL_BACKTEST_TICKERS:
        if any((CACHE / namespace / f"{symbol}_10y.json").exists()
               for namespace in ("yahoo_bars", "twelvedata_bars", "fmp_bars", "stooq_bars")):
            cached_symbols += 1
    bar_fields = "date, open, high, low, close, adjusted close, volume, dividends, splits"
    return {
        "historical_universe_size": len(HISTORICAL_BACKTEST_TICKERS),
        "symbols_with_cached_bars": cached_symbols,
        "symbols_with_point_in_time_float_cap": 0,
        "coverage_pct": 0.0,
        "cached_bar_fields": bar_fields,
        "missing_fields": [
            "historical shares outstanding",
            "historical float shares",
            "historical float-adjusted market capitalisation",
            "sector classification as known on each rebalance date",
        ],
        "candidate_sources": list(CANDIDATE_PIT_SOURCES),
        "conclusion": (
            "No point-in-time float-adjusted market cap exists in the project's data "
            "layer. A historical test of the Beta 0.5 sizing rule is therefore not "
            "available, and current float caps are never substituted for past values."
        ),
    }


def historical_proxy_comparison() -> dict:
    """Show that the exponent is inert on an equal-weight historical proxy.

    This is not a model comparison. It demonstrates that the three betas cannot
    be separated without size inputs, which is exactly why no historical CAGR
    table is published for them.
    """
    series = {}
    for symbol in HISTORICAL_BACKTEST_TICKERS:
        loaded = _load_series(symbol)
        if loaded is not None:
            series[symbol] = loaded
    for benchmark in ("SPY", "SPMO"):
        loaded = _load_series(benchmark)
        if loaded is not None:
            series[benchmark] = loaded
    if len(series) < 10:
        return {
            "available": False,
            "reason": "insufficient cached bars to run the historical proxy",
            "symbols_available": len(series),
        }
    universe = {symbol for symbol in HISTORICAL_BACKTEST_TICKERS if symbol in series}
    sectors = {
        symbol: MEMBER_BY_TICKER[symbol].sector
        for symbol in universe
        if symbol in MEMBER_BY_TICKER
    }
    runs = {}
    for beta in BETAS:
        runs[beta] = run_backtest(
            series,
            top_n=100,
            universe_symbols=universe,
            sector_by_symbol=sectors,
            rebalance_frequency="semiannual",
            market_cap_exponent=beta,
        )
    baseline = runs[MARKET_CAP_EXPONENT]
    if not baseline.get("available"):
        return {"available": False, "reason": baseline.get("reason", "backtest unavailable")}
    identical_holdings = all(
        runs[beta].get("holdings_log") == baseline.get("holdings_log") for beta in BETAS
    )
    identical_metrics = all(
        runs[beta].get("metrics") == baseline.get("metrics") for beta in BETAS
    )
    return {
        "available": True,
        "window": [baseline["start"], baseline["end"]],
        "weighting_mode": baseline["methodology"]["weighting_mode"],
        "selection": baseline["methodology"]["selection"],
        "rebalances": len(baseline["holdings_log"]),
        "identicalHoldingsAcrossBetas": identical_holdings,
        "identicalMetricsAcrossBetas": identical_metrics,
        "proxyMetrics": baseline["metrics"],
        "interpretation": (
            "All three exponents produce the same book because the historical proxy has "
            "no size input. These numbers describe the equal-weight momentum proxy, not "
            "the Beta 0.5 production rule."
        ),
    }


def main() -> int:
    payload = _load_publication()
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "official_default_market_cap_exponent": MARKET_CAP_EXPONENT,
        "selection_rule": "Momentum Score only; market cap never reorders the ranking",
        "classification": (
            "research comparison; the production default stays Beta 0.5 and is not "
            "chosen by maximising historical CAGR"
        ),
        "current_cross_section": (
            current_snapshot_comparison(payload)
            if payload
            else {"available": False, "reason": "static publication missing"}
        ),
        "point_in_time_coverage": audit_point_in_time_coverage(),
        "historical_comparison": {
            "available": False,
            "reason": (
                "point-in-time float-adjusted market capitalisation coverage is 0%, so "
                "CAGR, Sharpe, drawdown, turnover and sector concentration cannot be "
                "compared across betas without look-ahead bias"
            ),
            "proxy": historical_proxy_comparison(),
        },
        "limitations": [
            "The current cross-section uses today's float caps on today's signal date; that is not a backtest.",
            "No historical float, shares-outstanding or point-in-time sector history is available.",
            "The equal-weight proxy is published separately and never labelled as validating Beta 0.5.",
            "Survivorship: the universe is today's list, not a point-in-time membership record.",
        ],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    summary = {
        "output": str(OUTPUT.relative_to(ROOT)),
        "current_cross_section": report["current_cross_section"].get("selectionIdenticalAcrossModels"),
        "pit_coverage_pct": report["point_in_time_coverage"]["coverage_pct"],
        "historical_available": report["historical_comparison"]["available"],
        "proxy_available": report["historical_comparison"]["proxy"].get("available"),
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

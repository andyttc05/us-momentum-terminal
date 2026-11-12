#!/usr/bin/env python3
"""Reproduce period, holdout, and parameter-sensitivity checks from cached bars."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.backtest import run_backtest
from app.models import NormalizedBar
from app.momentum import SymbolSeries, build_frame
from app.universe import HISTORICAL_BACKTEST_TICKERS

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data-service" / "cache"
OUTPUT = ROOT / "data-service" / "docs" / "strategy_sensitivity.json"


def load_series(symbol: str, years: int = 10) -> SymbolSeries | None:
    path = CACHE / "yahoo_bars" / f"{symbol}_{years}y.json"
    if not path.exists():
        return None
    cached = json.loads(path.read_text())["value"]
    bars = [NormalizedBar(**row) for row in cached.get("bars", [])]
    frame = build_frame(bars)
    if frame is None:
        return None
    return SymbolSeries(
        symbol=symbol,
        frame=frame,
        source=cached.get("source", "yahoo"),
        source_label="Yahoo Finance",
        fetched_at=cached.get("fetched_at", ""),
        adjusted=bool(cached.get("adjusted")),
        is_backup=False,
    )


def period_metrics(strategy: pd.Series, start: str, end: str) -> dict:
    values = strategy.loc[(strategy.index >= pd.Timestamp(start)) & (strategy.index <= pd.Timestamp(end))]
    if len(values) < 20:
        return {"available": False}
    rebased = values / float(values.iloc[0]) * 100.0
    returns = rebased.pct_change().dropna()
    drawdown = rebased / rebased.cummax() - 1.0
    days = max(1, (rebased.index[-1] - rebased.index[0]).days)
    total = float(rebased.iloc[-1] / 100.0 - 1.0)
    cagr = ((1.0 + total) ** (365.0 / days) - 1.0) * 100.0
    volatility = float(returns.std() * math.sqrt(252) * 100.0) if len(returns) > 1 else None
    sharpe = (
        float(returns.mean() / returns.std() * math.sqrt(252))
        if len(returns) > 1 and returns.std() > 0
        else None
    )
    return {
        "available": True,
        "start": rebased.index[0].strftime("%Y-%m-%d"),
        "end": rebased.index[-1].strftime("%Y-%m-%d"),
        "total_return_pct": round(total * 100.0, 1),
        "cagr_pct": round(cagr, 1),
        "annualized_volatility_pct": round(volatility, 1) if volatility is not None else None,
        "max_drawdown_pct": round(float(drawdown.min() * 100.0), 1),
        "sharpe_zero_rf": round(sharpe, 2) if sharpe is not None else None,
    }


def metric_summary(result: dict) -> dict:
    metrics = result.get("metrics", {})
    return {
        "available": result.get("available", False),
        "start": result.get("start"),
        "end": result.get("end"),
        "cumulative_return_pct": metrics.get("cumulative_return"),
        "cagr_pct": metrics.get("cagr"),
        "annualized_volatility_pct": metrics.get("annualized_volatility"),
        "max_drawdown_pct": metrics.get("max_drawdown"),
        "sharpe_zero_rf": metrics.get("sharpe"),
        "transaction_cost_pct": metrics.get("transaction_cost_pct"),
        "annualized_turnover_pct": metrics.get("annualized_one_way_turnover_pct"),
        "rebalances": len(result.get("holdings_log", [])),
    }


def main() -> int:
    publication = json.loads((CACHE / "publication" / "snapshot.json").read_text())["value"]
    eligible = [row["ticker"] for row in publication["stocks"]]
    dollar_volume = {
        row["ticker"]: row.get("averageDailyDollarVolume3m") or 0
        for row in publication["stocks"]
    }
    # Keep the historical test on the audited core rather than retroactively
    # applying today's expanded scan universe.
    universe = set(HISTORICAL_BACKTEST_TICKERS) & set(eligible)
    series = {
        symbol: loaded
        for symbol in [*eligible, "SPY", "SPMO"]
        if (loaded := load_series(symbol)) is not None
    }
    if len(series) < len(eligible) + 2:
        raise RuntimeError("cached bars are incomplete for the sensitivity analysis")

    scenarios = {}
    definitions = {
        "base_top100_semiannual": {},
        "top50": {"top_n": 50},
        "top20_percent": {"top_n": None, "top_fraction": 0.2},
        "cost_0_bps": {"transaction_cost_rate": 0.0},
        "cost_25_bps": {"transaction_cost_rate": 0.0025},
        "cost_50_bps": {"transaction_cost_rate": 0.0050},
        "slippage_10_bps": {"slippage_rate": 0.0010},
        "slippage_25_bps": {"slippage_rate": 0.0025},
        "monthly_rebalance": {"rebalance_months": tuple(range(1, 13))},
    }
    for name, overrides in definitions.items():
        result = run_backtest(series, universe_symbols=universe, **overrides)
        scenarios[name] = metric_summary(result)

    for size in (50, 75):
        subset = set(sorted(universe, key=lambda symbol: dollar_volume.get(symbol, 0), reverse=True)[:size])
        result = run_backtest(series, top_n=min(100, size), universe_symbols=subset)
        scenarios[f"liquidity_top_{size}_universe"] = metric_summary(result)

    base = run_backtest(series, universe_symbols=universe)
    strategy = base["strategy"]
    end = strategy.index[-1].strftime("%Y-%m-%d")
    periods = {
        "in_sample_through_2022": period_metrics(strategy, base["start"], "2022-12-31"),
        "holdout_2023_to_end": period_metrics(strategy, "2023-01-01", end),
        "covid_recovery_2020_h2": period_metrics(strategy, "2020-04-01", "2020-12-31"),
        "bear_2022": period_metrics(strategy, "2022-01-01", "2022-12-31"),
        "bull_2023_2024": period_metrics(strategy, "2023-01-01", "2024-12-31"),
    }
    yearly_volatility = {}
    returns = strategy.pct_change().dropna()
    for year, values in returns.groupby(returns.index.year):
        if len(values) >= 30:
            yearly_volatility[int(year)] = round(float(values.std() * math.sqrt(252) * 100.0), 1)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "cached Yahoo Finance adjusted closes",
        "base_window": [base["start"], base["end"]],
        "eligible_universe_size": len(universe),
        "classification": "exploratory historical sensitivity; not an optimisation or future-performance claim",
        "scenarios": scenarios,
        "periods": periods,
        "yearly_realized_volatility_pct": yearly_volatility,
        "annual_returns": base["annual"],
        "execution": base["methodology"],
        "limitations": [
            "The universe list is current rather than point-in-time.",
            "Historical float-adjusted market caps are unavailable, so the backtest uses equal weights.",
            "The 2023-to-end result is a chronological holdout, not a separately trained model test.",
            "All results depend on the vendor's adjusted-close history and the 0% Sharpe risk-free assumption.",
        ],
    }
    OUTPUT.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

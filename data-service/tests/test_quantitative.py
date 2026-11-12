"""Independent unit tests for formulas, constraints, calendars and execution."""

from __future__ import annotations

import json
import unittest
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from app.backtest import run_backtest
from app.clock import NY, market_state
from app.models import NormalizedBar
from app.momentum import (
    SymbolSeries,
    _window_metrics,
    _zscore,
    build_frame,
    momentum_score,
)
from app.portfolio import build_portfolio
from app.snapshot import UNIVERSE_VERSION
from app.universe import (
    EXPANDED_UNIVERSE,
    HISTORICAL_BACKTEST_TICKERS,
    TICKERS,
    UNIVERSE,
)


class MomentumTests(unittest.TestCase):
    def test_score_transform_boundaries(self):
        self.assertEqual(momentum_score(0), 1.0)
        self.assertEqual(momentum_score(1), 2.0)
        self.assertEqual(momentum_score(-1), 0.5)
        self.assertEqual(momentum_score(3), 4.0)
        self.assertEqual(momentum_score(-3), 0.25)

    def test_zscore_is_capped_at_three(self):
        values = [0.0] * 100 + [100.0]
        z_scores = _zscore(values)
        self.assertEqual(max(z_scores), 3.0)
        self.assertTrue(all(-3.0 <= value <= 3.0 for value in z_scores))

    def test_zero_dispersion_has_neutral_scores(self):
        self.assertEqual(_zscore([2.0, 2.0, 2.0]), [0.0, 0.0, 0.0])

    def test_twelve_minus_one_skips_latest_month(self):
        closes = np.linspace(100.0, 160.0, 300)
        metrics = _window_metrics(closes, 299)
        expected = (closes[299 - 21] / closes[299 - 252] - 1.0) * 100.0
        self.assertAlmostEqual(metrics["momentum_12_1"], expected)
        self.assertAlmostEqual(
            metrics["risk_adjusted"],
            (closes[299 - 21] / closes[299 - 252] - 1.0) / metrics["daily_volatility"],
        )

    def test_missing_adjusted_close_is_not_filled_from_unadjusted(self):
        bars = [
            NormalizedBar(
                symbol="TEST",
                date="2026-01-02",
                open=10.0,
                high=11.0,
                low=9.0,
                close=10.0,
                adjusted_close=None,
                volume=1000.0,
                market_cap=None,
                dividends=0.0,
                stock_splits=0.0,
                data_source="test",
                last_updated="2026-01-02T00:00:00+00:00",
            )
        ]
        self.assertIsNone(build_frame(bars))


class PortfolioTests(unittest.TestCase):
    def _row(self, index, sector, score=1.5, cap=10_000_000_000.0):
        return {
            "symbol": f"S{index:03d}",
            "company": f"Stock {index}",
            "sector": sector,
            "score": score,
            "momentum_12_1": 10.0,
            "market_cap": cap,
            "float_market_cap": cap,
        }

    def test_portfolio_uses_score_and_float_cap_and_obeys_caps(self):
        sectors = ["Technology", "Communication", "Healthcare", "Consumer Staples", "Industrials", "Energy"]
        rows = [self._row(i, sectors[i % len(sectors)], score=1.0 + (i % 5) * 0.1) for i in range(100)]
        portfolio = build_portfolio(rows)
        self.assertTrue(portfolio["available"])
        self.assertTrue(all(item["passed"] for item in portfolio["constraints"]))
        self.assertAlmostEqual(sum(item["finalWeight"] for item in portfolio["holdings"]), 100.0, places=5)
        self.assertLessEqual(max(item["finalWeight"] for item in portfolio["holdings"]), 9.0 + 1e-7)

        by_symbol = {row["symbol"]: row for row in rows}
        weighted = [
            by_symbol[item["ticker"]]["float_market_cap"] * by_symbol[item["ticker"]]["score"]
            for item in portfolio["holdings"]
        ]
        total = sum(weighted)
        for expected, item in zip(weighted, portfolio["holdings"]):
            self.assertAlmostEqual(item["rawWeight"], expected / total * 100.0, places=3)

    def test_infeasible_name_cap_is_reported(self):
        sectors = ["Technology", "Communication", "Healthcare"]
        rows = [self._row(i, sectors[i % 3]) for i in range(10)]
        portfolio = build_portfolio(rows)
        self.assertFalse(portfolio["available"])
        self.assertIn("too few holdings", portfolio["reason"])


class CalendarTests(unittest.TestCase):
    def test_thanksgiving_is_closed(self):
        moment = datetime(2026, 11, 26, 10, 0, tzinfo=NY)
        self.assertEqual(market_state(moment)["state"], "closed")

    def test_early_close_is_after_hours(self):
        moment = datetime(2026, 11, 27, 15, 0, tzinfo=NY)
        self.assertEqual(market_state(moment)["state"], "after-hours")


def synthetic_series(symbol: str, days: int = 900) -> SymbolSeries:
    rng = np.random.default_rng(abs(hash(symbol)) % (2**32))
    trend = 0.00015 + (sum(map(ord, symbol)) % 7) * 0.00004
    returns = trend + rng.normal(0.0, 0.006, days)
    adjusted = 100.0 * np.cumprod(1.0 + returns)
    dates = pd.bdate_range("2023-01-02", periods=days)
    frame = pd.DataFrame(
        {
            "adj": adjusted,
            "close": adjusted,
            "volume": np.full(days, 2_000_000.0),
            "open": adjusted,
            "high": adjusted,
            "low": adjusted,
            "dividends": 0.0,
            "splits": 0.0,
        },
        index=dates,
    )
    return SymbolSeries(
        symbol=symbol,
        frame=frame,
        source="test",
        source_label="Synthetic",
        fetched_at="2026-01-01T00:00:00+00:00",
        adjusted=True,
        is_backup=False,
    )


class BacktestTests(unittest.TestCase):
    def test_semiannual_execution_and_transaction_cost(self):
        series = {symbol: synthetic_series(symbol) for symbol in ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]}
        series["SPY"] = synthetic_series("SPY")
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols={"AAA", "BBB", "CCC", "DDD", "EEE", "FFF"},
        )
        self.assertTrue(result["available"])
        self.assertGreaterEqual(result["metrics"]["transaction_cost_pct"], 0.1)
        for event in result["holdings_log"]:
            self.assertIn(int(event["signal_date"][5:7]), {3, 9})
            self.assertGreater(event["execution_date"], event["signal_date"])
            self.assertTrue(set(event["leaders"]).issubset({"AAA", "BBB", "CCC", "DDD", "EEE", "FFF"}))
        self.assertGreater(result["metrics"]["transaction_cost_pct"], 0.0)


class UniverseTests(unittest.TestCase):
    def test_live_universe_is_expanded_and_unique(self):
        self.assertGreaterEqual(len(TICKERS), 300)
        self.assertEqual(len(TICKERS), len(set(TICKERS)))
        self.assertEqual(len(EXPANDED_UNIVERSE), 200)
        self.assertEqual(len({member.sector for member in EXPANDED_UNIVERSE}), 11)

    def test_historical_backtest_universe_stays_on_audited_core(self):
        self.assertEqual(len(HISTORICAL_BACKTEST_TICKERS), 108)
        core = set(HISTORICAL_BACKTEST_TICKERS)
        added = {member.ticker for member in EXPANDED_UNIVERSE}
        self.assertFalse(core & added)
        self.assertTrue(all(member.instrument_type == "Common stock" for member in UNIVERSE if member.source != "core"))

    def test_published_seed_matches_current_universe_contract(self):
        seed_path = Path(__file__).resolve().parents[1] / "seed" / "publication.json"
        payload = json.loads(seed_path.read_text())["value"]
        self.assertEqual(payload["meta"]["universe_version"], UNIVERSE_VERSION)
        self.assertEqual(len(payload["stocks"]), 306)
        self.assertEqual(len({row["ticker"] for row in payload["stocks"]}), 306)


if __name__ == "__main__":
    unittest.main()

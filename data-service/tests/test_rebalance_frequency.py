"""Custom rebalance schedule and execution tests."""

from __future__ import annotations

import unittest
from collections import Counter
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app.backtest import REBALANCE_FREQUENCIES, rebalance_schedule, run_backtest
from app.main import backtest as run_backtest_endpoint
from app.momentum import SymbolSeries
from app.portfolio import group_sector


def series(symbol: str, days: int = 900) -> SymbolSeries:
    rng = np.random.default_rng(sum(map(ord, symbol)) % (2**32))
    returns = 0.0002 + rng.normal(0.0, 0.006, days)
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


class RebalanceScheduleTests(unittest.TestCase):
    def test_exact_months_and_unique_next_session_execution(self):
        sessions = pd.bdate_range("2023-01-02", "2025-12-31")
        expected = {
            "monthly": set(range(1, 13)),
            "quarterly": {3, 6, 9, 12},
            "semiannual": {3, 9},
            "annual": {9},
        }
        for frequency, months in expected.items():
            events = rebalance_schedule(sessions, frequency=frequency)
            self.assertEqual(
                {sessions[event["signal_position"]].month for event in events},
                months,
            )
            executions = [event["execution_position"] for event in events]
            self.assertEqual(len(executions), len(set(executions)))
            self.assertTrue(all(event["signal_position"] < event["execution_position"] for event in events))

    def test_partial_range_initial_formation_and_boundaries(self):
        sessions = pd.bdate_range("2023-01-02", "2025-12-31")
        events = rebalance_schedule(
            sessions,
            frequency="monthly",
            start="2024-04-17",
            end="2024-11-20",
        )
        self.assertEqual(events[0]["kind"], "initial_formation")
        self.assertEqual(sessions[events[0]["execution_position"]], pd.Timestamp("2024-04-17"))
        self.assertEqual(sum(sessions[event["execution_position"]].month == 4 for event in events), 1)
        self.assertFalse(any(event["scheduled_month"] == 11 for event in events))
        self.assertTrue(all(sessions[event["execution_position"]] <= pd.Timestamp("2024-11-20") for event in events))

    def test_holiday_uses_last_session_and_next_execution(self):
        sessions = pd.bdate_range("2024-01-02", "2024-06-28")
        sessions = sessions[sessions != pd.Timestamp("2024-03-29")]
        first = rebalance_schedule(sessions, frequency="semiannual")[0]
        self.assertEqual(sessions[first["signal_position"]], pd.Timestamp("2024-03-28"))
        self.assertEqual(sessions[first["execution_position"]], pd.Timestamp("2024-04-01"))


class RebalanceExecutionTests(unittest.TestCase):
    def setUp(self):
        self.symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        self.series = {symbol: series(symbol) for symbol in self.symbols}

    def test_all_frequencies_change_holdings_on_their_own_schedule(self):
        results = {
            frequency: run_backtest(
                self.series,
                top_n=3,
                universe_symbols=set(self.symbols),
                rebalance_frequency=frequency,
            )
            for frequency in REBALANCE_FREQUENCIES
        }
        for frequency, result in results.items():
            self.assertTrue(result["available"], result.get("reason"))
            self.assertEqual(result["event_counts"]["initial_formation"], 1)
            self.assertIn(
                int(result["holdings_log"][0]["signal_date"][5:7]),
                set(REBALANCE_FREQUENCIES[frequency]),
            )
            for event in result["holdings_log"]:
                self.assertLess(event["signal_date"], event["execution_date"])
                self.assertAlmostEqual(sum(event["holdings"].values()), 100.0, places=3)
        counts = [
            len(results[name]["holdings_log"])
            for name in ("monthly", "quarterly", "semiannual", "annual")
        ]
        self.assertGreater(counts[0], counts[1])
        self.assertGreater(counts[1], counts[2])
        self.assertGreaterEqual(counts[2], counts[3])
        self.assertGreater(
            results["monthly"]["metrics"]["transaction_cost_pct"],
            results["annual"]["metrics"]["transaction_cost_pct"],
        )
        repeat = run_backtest(
            self.series,
            top_n=3,
            universe_symbols=set(self.symbols),
            rebalance_frequency="quarterly",
        )
        self.assertEqual(results["quarterly"]["holdings_log"], repeat["holdings_log"])
        self.assertEqual(results["quarterly"]["metrics"], repeat["metrics"])

    def test_stock_and_sector_caps_are_enforced(self):
        symbols = [f"S{index:02d}" for index in range(20)]
        sectors = ["Technology", "Healthcare", "Financials", "Energy"]
        sector_by_symbol = {
            symbol: sectors[index % len(sectors)]
            for index, symbol in enumerate(symbols)
        }
        result = run_backtest(
            {symbol: series(symbol) for symbol in symbols},
            top_n=20,
            universe_symbols=set(symbols),
            rebalance_frequency="quarterly",
            sector_by_symbol=sector_by_symbol,
        )
        self.assertTrue(result["available"], result.get("reason"))
        for event in result["holdings_log"]:
            self.assertLessEqual(max(event["holdings"].values()), 9.0 + 1e-6)
            totals = Counter()
            for symbol, weight in event["holdings"].items():
                totals[group_sector(sector_by_symbol[symbol])] += weight
            self.assertLessEqual(max(totals.values()), 35.0 + 1e-3)

    def test_missing_history_is_never_selected(self):
        bad = series("BAD")
        bad.frame.loc[:, ["adj", "close"]] = np.nan
        result = run_backtest(
            {**self.series, "BAD": bad},
            top_n=3,
            universe_symbols=set(self.symbols) | {"BAD"},
            rebalance_frequency="quarterly",
        )
        self.assertTrue(result["available"], result.get("reason"))
        self.assertTrue(all("BAD" not in event["leaders"] for event in result["holdings_log"]))
        self.assertTrue(np.isfinite(result["strategy"]).all())

    def test_future_prices_cannot_change_the_first_rebalance(self):
        baseline = run_backtest(
            self.series,
            top_n=3,
            universe_symbols=set(self.symbols),
            rebalance_frequency="semiannual",
        )
        first = baseline["holdings_log"][0]
        altered = {}
        cut = pd.Timestamp(first["execution_date"])
        for symbol, original in self.series.items():
            frame = original.frame.copy()
            frame.loc[frame.index > cut, ["adj", "close"]] *= 3.0
            altered[symbol] = SymbolSeries(
                symbol=symbol,
                frame=frame,
                source=original.source,
                source_label=original.source_label,
                fetched_at=original.fetched_at,
                adjusted=original.adjusted,
                is_backup=original.is_backup,
            )
        changed = run_backtest(
            altered,
            top_n=3,
            universe_symbols=set(self.symbols),
            rebalance_frequency="semiannual",
        )
        self.assertEqual(changed["holdings_log"][0]["holdings"], first["holdings"])

    def test_api_forwards_frequency_and_rejects_invalid_values(self):
        with patch(
            "app.main.run_historical_backtest",
            return_value={
                "available": True,
                "request": {
                    "portfolio": "top100",
                    "rebalanceFrequency": "quarterly",
                    "start": "2024-01-02",
                    "end": "2025-12-31",
                },
            },
        ) as runner:
            response = run_backtest_endpoint(
                {
                    "portfolio": "top100",
                    "start": "2024-01-02",
                    "end": "2025-12-31",
                    "rebalance_frequency": "quarterly",
                }
            )
        runner.assert_called_once()
        self.assertEqual(response.status_code, 200)
        with self.assertRaises(HTTPException):
            run_backtest_endpoint(
                {
                    "portfolio": "top100",
                    "start": "2024-01-02",
                    "end": "2025-12-31",
                    "rebalance_frequency": "weekly",
                }
            )


if __name__ == "__main__":
    unittest.main()

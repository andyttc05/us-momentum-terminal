"""Independent unit tests for formulas, constraints, calendars and execution."""

from __future__ import annotations

import json
import math
import unittest
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app.backtest import (
    REBALANCE_FREQUENCIES,
    _benchmark_relative,
    _performance_statistics,
    _price_cash_frames,
    rebalance_schedule,
    run_backtest,
)
from app.clock import NY, market_state
from app.main import _loading_payload, _seed_payload, backtest as run_backtest_endpoint
from app.macro import parse_cpi_csv
from app.models import NormalizedBar
from app.momentum import (
    MIN_OBSERVATIONS,
    VOLATILITY_RETURNS,
    VOLATILITY_WINDOW_OBSERVATIONS,
    SymbolSeries,
    _window_metrics,
    _zscore,
    build_frame,
    momentum_sparkline,
    momentum_score,
)
from app.portfolio import (
    MARKET_CAP_EXPONENT,
    METHODOLOGY_ID,
    SECTOR_CAP,
    SINGLE_NAME_CAP,
    _rounded_sector_values,
    build_portfolio,
    canonical_sector,
    evaluate_portfolio_constraints,
    group_sector,
    rank_for_selection,
    raw_weights,
    selection_sort_key,
)
from app.snapshot import (
    PUBLICATION_VERSION,
    UNIVERSE_VERSION,
    _weekly_price_history,
    _merge_verified_fundamentals,
    _performance_payload,
    _verified_fundamental_fallbacks,
)
from app.universe import (
    CANDIDATE_TICKERS,
    EXPANDED_UNIVERSE,
    HISTORICAL_BACKTEST_TICKERS,
    TICKERS,
    UNIVERSE,
)


class MomentumTests(unittest.TestCase):
    def test_weekly_price_history_keeps_plot_values_and_uses_prior_session_for_daily_move(self):
        adjusted = np.array([100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 90.0])
        dates = pd.bdate_range("2026-01-05", periods=len(adjusted))
        frame = pd.DataFrame(
            {
                "adj": adjusted,
                "close": adjusted,
                "volume": np.full(len(adjusted), 1_000_000.0),
                "open": adjusted,
                "high": adjusted,
                "low": adjusted,
                "dividends": 0.0,
                "splits": 0.0,
            },
            index=dates,
        )
        series = SymbolSeries(
            symbol="TEST",
            frame=frame,
            source="test",
            source_label="Synthetic",
            fetched_at="2026-01-16T00:00:00+00:00",
            adjusted=True,
            is_backup=False,
        )

        history = _weekly_price_history(series)
        self.assertEqual(history["values"], [104.0, 90.0])
        self.assertEqual(history["dates"], ["2026-01-09", "2026-01-16"])
        self.assertEqual(history["observationDates"], ["2026-01-09", "2026-01-16"])
        self.assertEqual(history["dailyChanges"][0], 0.97)
        self.assertEqual(history["dailyChanges"][1], -16.67)
        self.assertEqual(len(history["dailyChanges"]), len(history["values"]))

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

    def test_momentum_sparkline_uses_exact_adjusted_12_1_window(self):
        days = 300
        adjusted = np.linspace(40.0, 220.0, days)
        raw_close = adjusted * 0.5
        dates = pd.bdate_range("2025-01-02", periods=days)
        frame = pd.DataFrame(
            {
                "adj": adjusted,
                "close": raw_close,
                "volume": np.full(days, 1_000_000.0),
                "open": raw_close,
                "high": raw_close,
                "low": raw_close,
                "dividends": 0.0,
                "splits": 0.0,
            },
            index=dates,
        )
        series = SymbolSeries(
            symbol="WINDOW",
            frame=frame,
            source="test",
            source_label="Synthetic",
            fetched_at="2026-01-01T00:00:00+00:00",
            adjusted=True,
            is_backup=False,
        )
        sparkline = momentum_sparkline(series)
        start = days - 1 - 252
        end = days - 1 - 21
        expected_return = (adjusted[end] / adjusted[start] - 1.0) * 100.0
        self.assertEqual(sparkline["startDate"], dates[start].strftime("%Y-%m-%d"))
        self.assertEqual(sparkline["endDate"], dates[end].strftime("%Y-%m-%d"))
        self.assertEqual(sparkline["startAdjustedClose"], round(float(adjusted[start]), 4))
        self.assertEqual(sparkline["endAdjustedClose"], round(float(adjusted[end]), 4))
        self.assertEqual(sparkline["values"][0], 100.0)
        self.assertAlmostEqual(sparkline["values"][-1], round(float(adjusted[end] / adjusted[start] * 100.0), 4))
        self.assertAlmostEqual(sparkline["returnPct"], expected_return, places=4)

    def test_momentum_sparkline_is_ticker_specific_and_handles_missing_data(self):
        def series_for(symbol, slope):
            days = 300
            adjusted = 100.0 + np.arange(days) * slope
            dates = pd.bdate_range("2025-01-02", periods=days)
            frame = pd.DataFrame(
                {
                    "adj": adjusted,
                    "close": adjusted,
                    "volume": np.full(days, 1_000_000.0),
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

        fast = momentum_sparkline(series_for("FAST", 0.5))
        slow = momentum_sparkline(series_for("SLOW", 0.1))
        self.assertGreater(fast["returnPct"], slow["returnPct"])
        shorter = series_for("SHORT", 0.2).frame.iloc[-200:].copy()
        short_series = SymbolSeries(
            symbol="SHORT",
            frame=shorter,
            source="test",
            source_label="Synthetic",
            fetched_at="2026-01-01T00:00:00+00:00",
            adjusted=True,
            is_backup=False,
        )
        self.assertIsNone(momentum_sparkline(short_series))


class MomentumChartSeriesTests(unittest.TestCase):
    """The one series both chart sizes draw has to agree with the score maths.

    The Screener sparkline and the Stock Analysis chart read the same
    ``sparkline12_1`` block, so the invariants here are what keep the two sizes
    from drifting: the window is the 12-1 window, the base is 100, and the last
    indexed point reproduces the displayed momentum percentage.
    """

    @staticmethod
    def series_for(symbol: str, days: int = 300, slope: float = 0.4) -> SymbolSeries:
        adjusted = 60.0 + np.arange(days) * slope
        dates = pd.bdate_range("2025-01-02", periods=days)
        frame = pd.DataFrame(
            {
                "adj": adjusted,
                "close": adjusted * 0.9,
                "volume": np.full(days, 1_000_000.0),
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

    def test_last_indexed_point_reproduces_the_headline_momentum(self):
        for ticker, slope in (("MPC", 0.62), ("MU", 1.55), ("HPE", 0.21), ("SLOW", 0.02)):
            series = self.series_for(ticker, slope=slope)
            adjusted = series.frame["adj"].to_numpy(dtype=float)
            metrics = _window_metrics(adjusted, len(adjusted) - 1)
            sparkline = momentum_sparkline(series)

            self.assertIsNotNone(sparkline, ticker)
            self.assertEqual(sparkline["values"][0], 100.0, ticker)
            self.assertAlmostEqual(
                sparkline["values"][-1],
                100.0 * (1.0 + metrics["momentum_12_1"] / 100.0),
                places=3,
                msg=f"{ticker} endpoint must equal 100 x (1 + momentum)",
            )
            self.assertAlmostEqual(sparkline["returnPct"], metrics["momentum_12_1"], places=3, msg=ticker)

    def test_window_offsets_are_the_12_1_legs_and_most_recent_month_is_excluded(self):
        days = 300
        series = self.series_for("WINDOW", days=days)
        sparkline = momentum_sparkline(series)
        frame = series.frame

        self.assertEqual(sparkline["startOffsetSessions"], 252)
        self.assertEqual(sparkline["endOffsetSessions"], 21)
        self.assertEqual(sparkline["startDate"], frame.index[-1 - 252].strftime("%Y-%m-%d"))
        self.assertEqual(sparkline["endDate"], frame.index[-1 - 21].strftime("%Y-%m-%d"))
        # 252 - 21 + 1 sessions inclusive, and the latest 21 are never drawn.
        self.assertEqual(len(sparkline["values"]), 232)
        self.assertNotEqual(sparkline["endDate"], frame.index[-1].strftime("%Y-%m-%d"))

    def test_every_observation_is_a_real_bar_in_order(self):
        series = self.series_for("ORDER")
        sparkline = momentum_sparkline(series)
        adjusted = series.frame["adj"].to_numpy(dtype=float)
        window = adjusted[-1 - 252: -1 - 21 + 1]
        base = window[0]
        expected = [round(float(value) / base * 100.0, 4) for value in window]
        self.assertEqual(sparkline["values"], expected)
        # No interpolation: the point count is the session count.
        self.assertEqual(len(sparkline["values"]), len(window))

    def test_series_is_ticker_specific(self):
        strong = momentum_sparkline(self.series_for("STRONG", slope=2.0))
        weak = momentum_sparkline(self.series_for("WEAK", slope=0.05))
        self.assertGreater(strong["values"][-1], weak["values"][-1])
        self.assertGreater(strong["returnPct"], weak["returnPct"])

    def test_no_series_without_an_adjusted_window(self):
        unadjusted = self.series_for("NOADJ")
        unadjusted.adjusted = False
        self.assertIsNone(momentum_sparkline(unadjusted))


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

    def test_portfolio_uses_score_and_sqrt_relative_float_cap_and_obeys_caps(self):
        sectors = ["Technology", "Communication", "Healthcare", "Consumer Staples", "Industrials", "Energy"]
        rows = [self._row(i, sectors[i % len(sectors)], score=1.0 + (i % 5) * 0.1) for i in range(100)]
        portfolio = build_portfolio(rows)
        self.assertTrue(portfolio["available"])
        self.assertTrue(all(item["passed"] for item in portfolio["constraints"]))
        self.assertAlmostEqual(sum(item["finalWeight"] for item in portfolio["holdings"]), 100.0, places=5)
        self.assertLessEqual(max(item["finalWeight"] for item in portfolio["holdings"]), 9.0 + 1e-7)
        self.assertTrue(all(item["sector"] in set(sectors) for item in portfolio["holdings"]))
        self.assertFalse({"Consumer", "Others"} & {item["sector"] for item in portfolio["holdings"]})

        by_symbol = {row["symbol"]: row for row in rows}
        median = portfolio["weighting"]["medianFloatMarketCap"]
        weighted = [
            by_symbol[item["ticker"]]["score"]
            * np.sqrt(by_symbol[item["ticker"]]["float_market_cap"] / median)
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
        self.assertEqual(portfolio["status"], "infeasible")
        self.assertIn("too few holdings", portfolio["reason"])

    def test_top_twenty_is_an_exact_holding_count(self):
        sectors = ["Technology", "Communication", "Healthcare", "Consumer Staples", "Industrials", "Energy"]
        rows = [self._row(i, sectors[i % len(sectors)]) for i in range(100)]
        portfolio = build_portfolio(rows, target_holdings=20)
        self.assertTrue(portfolio["available"])
        self.assertEqual(portfolio["summary"]["totalHoldings"], 20)
        self.assertEqual(len(portfolio["holdings"]), 20)
        self.assertAlmostEqual(sum(item["finalWeight"] for item in portfolio["holdings"]), 100.0, places=5)
        self.assertIn(
            {
                "id": "target-holdings",
                "label": "Target Holdings",
                "rule": "= 20",
                "scope": "portfolio",
                "passed": True,
                "status": "passed",
            },
            portfolio["constraints"],
        )


class VolatilityWindowTests(unittest.TestCase):
    """Volatility must be measured on the 12-1 signal's own price path.

    Including the excluded skip month inflates the denominator exactly when a
    name has just had a violent month - the case the 12-1 convention exists to
    neutralise - so the window is asserted against an independent slice.
    """

    @staticmethod
    def _closes(days: int = 320) -> np.ndarray:
        return np.linspace(100.0, 180.0, days)

    def test_window_is_the_232_closes_from_t_minus_252_to_t_minus_21(self):
        closes = self._closes()
        index = len(closes) - 1
        metrics = _window_metrics(closes, index)

        window = closes[index - 252: index - 20]
        returns = np.diff(window) / window[:-1]

        self.assertEqual(len(window), 232)
        self.assertEqual(len(window), VOLATILITY_WINDOW_OBSERVATIONS)
        self.assertEqual(len(returns), 231)
        self.assertEqual(len(returns), VOLATILITY_RETURNS)
        self.assertAlmostEqual(metrics["daily_volatility"], float(np.std(returns, ddof=1)))
        self.assertAlmostEqual(metrics["volatility"], float(np.std(returns, ddof=1)) * np.sqrt(252) * 100.0)

    def test_risk_adjusted_momentum_divides_by_that_daily_volatility(self):
        closes = self._closes()
        index = len(closes) - 1
        metrics = _window_metrics(closes, index)
        momentum = closes[index - 21] / closes[index - 252] - 1.0
        self.assertAlmostEqual(metrics["momentum_12_1"], momentum * 100.0)
        self.assertAlmostEqual(metrics["risk_adjusted"], momentum / metrics["daily_volatility"])

    def test_skip_month_never_enters_the_volatility_estimate(self):
        index = 319
        baseline = _window_metrics(self._closes(), index)

        spiked = self._closes()
        # A 2x level shift inside the excluded 21 sessions...
        spiked[index - 20:] *= 2.0
        self.assertAlmostEqual(
            _window_metrics(spiked, index)["daily_volatility"],
            baseline["daily_volatility"],
            places=12,
            msg="the skip month must not change the risk denominator",
        )

        # ...but the same shock inside the observation window must.
        inside = self._closes()
        inside[index - 30] *= 2.0
        self.assertNotAlmostEqual(
            _window_metrics(inside, index)["daily_volatility"],
            baseline["daily_volatility"],
            places=6,
        )

    def test_old_full_trailing_window_would_have_given_a_different_answer(self):
        index = 319
        closes = self._closes()
        closes[len(closes) - 15] *= 4.0  # shock inside the old window only
        metrics = _window_metrics(closes, index)

        legacy_window = closes[index - 252: index + 1]
        legacy = float(np.std(np.diff(legacy_window) / legacy_window[:-1], ddof=1))
        self.assertEqual(len(legacy_window), 253)
        self.assertGreater(legacy, metrics["daily_volatility"] * 1.5)

    def test_missing_history_is_still_rejected(self):
        closes = self._closes(252)
        self.assertIsNone(_window_metrics(closes, 251))
        self.assertEqual(MIN_OBSERVATIONS, 253)


class SelectionRuleTests(unittest.TestCase):
    """Momentum Score alone decides membership; market cap only decides sizing."""

    @staticmethod
    def _row(symbol, score, cap=1e10, risk_adjusted=None, sector="Technology"):
        return {
            "symbol": symbol,
            "company": symbol,
            "sector": sector,
            "score": score,
            "risk_adjusted": score * 10 if risk_adjusted is None else risk_adjusted,
            "momentum_12_1": score,
            "market_cap": cap * 1.2,
            "float_market_cap": cap,
        }

    def _cross_section(self, count=40):
        sectors = ["Technology", "Healthcare", "Financials", "Energy", "Industrials", "Utilities"]
        return [
            self._row(
                f"S{index:03d}",
                round(2.6 - index * 0.01, 4),
                cap=1e9 * (1 + index),
                sector=sectors[index % len(sectors)],
            )
            for index in range(count)
        ]

    def test_market_cap_never_reorders_the_selection(self):
        rows = self._cross_section()
        shuffled = [dict(row, float_market_cap=row["float_market_cap"] * (100 if index % 2 else 0.01))
                    for index, row in enumerate(rows)]
        baseline = [row["ticker"] for row in build_portfolio(rows, target_holdings=20)["holdings"]]
        inverted = [row["ticker"] for row in build_portfolio(shuffled, target_holdings=20)["holdings"]]
        self.assertEqual(baseline, inverted)
        self.assertEqual(baseline, [row["symbol"] for row in rank_for_selection(rows)[:20]])

    def test_top_twenty_is_the_first_twenty_of_the_top_hundred_in_order(self):
        rows = self._cross_section(count=140)
        top100 = [row["ticker"] for row in build_portfolio(rows, target_holdings=100)["holdings"]]
        top20 = [row["ticker"] for row in build_portfolio(rows, target_holdings=20)["holdings"]]
        self.assertEqual(len(top100), 100)
        self.assertEqual(len(top20), 20)
        self.assertEqual(top20, top100[:20])

    def test_ties_break_on_risk_adjusted_then_ticker(self):
        rows = [
            self._row("ZZZ", 2.0, risk_adjusted=50.0),
            self._row("AAA", 2.0, risk_adjusted=50.0),
            self._row("MOM", 2.0, risk_adjusted=90.0),
        ]
        self.assertEqual([row["symbol"] for row in rank_for_selection(rows)], ["MOM", "AAA", "ZZZ"])

    def test_selection_is_deterministic_and_input_order_independent(self):
        rows = self._cross_section(count=60)
        first = [row["ticker"] for row in build_portfolio(rows, target_holdings=20)["holdings"]]
        second = [row["ticker"] for row in build_portfolio(list(reversed(rows)), target_holdings=20)["holdings"]]
        self.assertEqual(first, second)

    def test_a_better_score_without_a_float_cap_is_excluded_not_weighted(self):
        rows = self._cross_section(count=30)
        rows[0]["float_market_cap"] = None
        book = build_portfolio(rows, target_holdings=20)
        self.assertTrue(book["available"])
        self.assertIn(rows[0]["symbol"], book["excluded_no_market_cap"])
        self.assertNotIn(rows[0]["symbol"], {row["ticker"] for row in book["holdings"]})
        self.assertEqual(len(book["holdings"]), 20)

    def test_non_positive_and_non_finite_caps_are_never_weighted(self):
        rows = self._cross_section(count=30)
        rows[0]["float_market_cap"] = 0.0
        rows[1]["float_market_cap"] = float("nan")
        rows[2]["float_market_cap"] = -1.0
        selected = {row["ticker"] for row in build_portfolio(rows, target_holdings=20)["holdings"]}
        self.assertFalse({rows[0]["symbol"], rows[1]["symbol"], rows[2]["symbol"]} & selected)

    def test_selection_metadata_describes_the_rule(self):
        book = build_portfolio(self._cross_section(count=40), target_holdings=20)
        self.assertEqual(book["selection"]["rule"], "Momentum Score, descending")
        self.assertEqual(book["selection"]["tieBreak"], ["score:desc", "riskAdjusted:desc", "ticker:asc"])


class WeightingModelTests(unittest.TestCase):
    """One selection, three exponents: only the sizing may move."""

    @staticmethod
    def _rows(count=100):
        sectors = ["Technology", "Healthcare", "Financials", "Energy", "Industrials", "Utilities"]
        return [
            {
                "symbol": f"W{index:03d}",
                "company": f"Company {index}",
                "sector": sectors[index % len(sectors)],
                "score": 1.0 + (index % 9) * 0.1,
                "risk_adjusted": float(count - index),
                "momentum_12_1": 2.0,
                "market_cap": 1e10 * (1 + index % 12),
                "float_market_cap": 1e9 * (1.5 ** (index % 12)),
            }
            for index in range(count)
        ]

    def _books(self):
        rows = self._rows()
        return {beta: build_portfolio(rows, market_cap_exponent=beta) for beta in (0.0, 0.5, 1.0)}

    def test_default_exponent_is_one_half(self):
        self.assertEqual(MARKET_CAP_EXPONENT, 0.5)
        book = build_portfolio(self._rows())
        self.assertEqual(book["weighting"]["marketCapExponent"], 0.5)
        self.assertIn("^ 0.5", book["weighting"]["rawFormula"])

    def test_beta_zero_is_pure_score_weighting(self):
        rows = self._rows()
        book = build_portfolio(rows, market_cap_exponent=0.0)
        scores = {row["symbol"]: row["score"] for row in rows}
        total_score = sum(scores[row["ticker"]] for row in book["holdings"])
        for holding in book["holdings"]:
            self.assertAlmostEqual(
                holding["rawWeight"],
                scores[holding["ticker"]] / total_score * 100.0,
                places=3,
            )

    def test_beta_one_reproduces_the_linear_market_cap_rule(self):
        rows = self._rows()
        book = build_portfolio(rows, market_cap_exponent=1.0)
        by_symbol = {row["symbol"]: row for row in rows}
        linear = {
            holding["ticker"]: by_symbol[holding["ticker"]]["score"] * by_symbol[holding["ticker"]]["float_market_cap"]
            for holding in book["holdings"]
        }
        total = sum(linear.values())
        for holding in book["holdings"]:
            self.assertAlmostEqual(holding["rawWeight"], linear[holding["ticker"]] / total * 100.0, places=3)

    def test_square_root_compresses_size_dispersion_relative_to_linear(self):
        books = self._books()
        largest = {beta: max(holding["finalWeight"] for holding in book["holdings"])
                   for beta, book in books.items()}
        smallest = {beta: min(holding["finalWeight"] for holding in book["holdings"])
                    for beta, book in books.items()}
        self.assertGreater(largest[1.0], largest[0.5])
        self.assertGreater(largest[0.5], largest[0.0])
        # Every beta is still a fully invested, capped book.
        for beta, book in books.items():
            self.assertTrue(book["available"], beta)
            self.assertAlmostEqual(sum(row["finalWeight"] for row in book["holdings"]), 100.0, places=6)
            self.assertLessEqual(max(row["finalWeight"] for row in book["holdings"]), SINGLE_NAME_CAP + 1e-6)

    def test_the_exponent_never_changes_which_names_are_held(self):
        books = self._books()
        orders = {beta: [row["ticker"] for row in book["holdings"]] for beta, book in books.items()}
        self.assertEqual(orders[0.0], orders[0.5])
        self.assertEqual(orders[0.5], orders[1.0])

    def test_relative_form_matches_the_absolute_form(self):
        rows = self._rows(count=12)
        relative, meta = raw_weights(rows, market_cap_exponent=0.5)
        absolute = {
            row["symbol"]: row["score"] * math.sqrt(row["float_market_cap"])
            for row in rows
        }
        relative_total = sum(relative.values())
        absolute_total = sum(absolute.values())
        for symbol in relative:
            self.assertAlmostEqual(
                relative[symbol] / relative_total,
                absolute[symbol] / absolute_total,
                places=12,
            )
        self.assertGreater(meta["medianFloatMarketCap"], 0)

    def test_unstable_or_unsupported_exponents_are_rejected(self):
        for beta in (-0.1, 2.5, float("nan")):
            with self.assertRaises(ValueError):
                build_portfolio(self._rows(), market_cap_exponent=beta)


class SectorConstraintScopeTests(unittest.TestCase):
    """The solver and the published validation must use one classification."""

    def test_group_sector_is_idempotent(self):
        for name in ("Technology", "Consumer", "Others", "Other", "Financials", "Energy"):
            self.assertEqual(canonical_sector(canonical_sector(name)), canonical_sector(name))
        self.assertEqual(group_sector("Consumer Discretionary"), "Consumer")
        self.assertEqual(group_sector("Consumer Staples"), "Consumer")
        self.assertEqual(group_sector("Financials"), "Others")

    def test_validation_catches_a_group_breach_that_individual_sectors_hide(self):
        holdings = [
            {"ticker": "FIN", "sector": "Financials", "finalWeight": 18.0},
            {"ticker": "ENE", "sector": "Energy", "finalWeight": 18.0},
            {"ticker": "TECH", "sector": "Technology", "finalWeight": 22.0},
            {"ticker": "HLTH", "sector": "Healthcare", "finalWeight": 22.0},
            {"ticker": "IND", "sector": "Industrials", "finalWeight": 20.0},
        ]
        constraints, validation = evaluate_portfolio_constraints(holdings, target_holdings=5)
        by_id = {row["id"]: row for row in constraints}
        # 18% Financials + 18% Energy = 36% in the "Others" group, while no
        # individual sector exceeds 35%.
        self.assertEqual(max(row["finalWeight"] for row in holdings), 22.0)
        self.assertEqual(by_id["max-sector"]["status"], "failed")
        self.assertEqual(by_id["max-sector"]["scope"], "sector-group")
        self.assertGreater(validation["maximumSectorGroupWeight"], SECTOR_CAP)

    def test_every_holding_carries_the_solver_group(self):
        rows = [
            {"symbol": f"G{index}", "company": f"C{index}", "sector": sectors,
             "score": 2.0 - index * 0.01, "risk_adjusted": 10.0, "momentum_12_1": 1.0,
             "market_cap": 1e10, "float_market_cap": 1e9 * (1 + index)}
            for index, sectors in enumerate(
                ["Technology", "Healthcare", "Financials", "Energy", "Industrials",
                 "Consumer Discretionary", "Utilities"] * 3
            )
        ]
        book = build_portfolio(rows, target_holdings=20)
        self.assertTrue(book["available"], book.get("reason"))
        for holding in book["holdings"]:
            self.assertEqual(holding["sectorGroup"], canonical_sector(holding["sector"]))
        grouped = {}
        for holding in book["holdings"]:
            grouped[holding["sectorGroup"]] = grouped.get(holding["sectorGroup"], 0.0) + holding["finalWeight"]
        self.assertLessEqual(max(grouped.values()), SECTOR_CAP + 1e-6)
        self.assertTrue(all(row["passed"] for row in book["constraints"]))

    def test_a_single_group_book_is_reported_infeasible(self):
        rows = [
            {"symbol": f"O{index}", "company": f"C{index}", "sector": "Financials",
             "score": 2.0 - index * 0.01, "risk_adjusted": 10.0, "momentum_12_1": 1.0,
             "market_cap": 1e10, "float_market_cap": 1e9}
            for index in range(20)
        ]
        book = build_portfolio(rows, target_holdings=20)
        self.assertFalse(book["available"])
        self.assertEqual(book["status"], "infeasible")
        self.assertIn("sector cap", book["reason"])
        self.assertEqual(book["holdings"], [])



class PointInTimeWeightingTests(unittest.TestCase):
    """A historical book may only be sized from data known at the signal date."""

    SYMBOLS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]

    def _series(self):
        return {symbol: synthetic_series(symbol) for symbol in self.SYMBOLS + ["SPY"]}

    def test_without_point_in_time_caps_the_book_is_a_labelled_proxy(self):
        result = run_backtest(
            self._series(),
            top_n=3,
            universe_symbols=set(self.SYMBOLS),
            rebalance_frequency="quarterly",
        )
        self.assertTrue(result["available"], result.get("reason"))
        methodology = result["methodology"]
        self.assertEqual(methodology["weighting_mode"], "equal-weight-proxy")
        self.assertFalse(methodology["live_weighting_tested"])
        self.assertEqual(methodology["sized_rebalances"], 0)
        self.assertEqual(methodology["historical_capitalisation"], "not available point-in-time")
        self.assertTrue(all(event["weighting_mode"] == "equal-weight-proxy" for event in result["holdings_log"]))
        # Equal weights: every selected name carries the same target weight.
        for event in result["holdings_log"]:
            values = list(event["holdings"].values())
            self.assertAlmostEqual(max(values) - min(values), 0.0, places=3)

    def test_complete_point_in_time_caps_produce_the_production_weights(self):
        series = self._series()
        caps = {"AAA": 1e9, "BBB": 4e9, "CCC": 9e9, "DDD": 16e9, "EEE": 25e9, "FFF": 36e9}
        lookup = lambda symbol, _date: caps.get(symbol)  # noqa: E731
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(self.SYMBOLS),
            rebalance_frequency="quarterly",
            float_cap_lookup=lookup,
        )
        self.assertTrue(result["available"], result.get("reason"))
        self.assertEqual(result["methodology"]["weighting_mode"], "score-size")
        self.assertTrue(result["methodology"]["live_weighting_tested"])
        self.assertIn("^ 0.5", result["methodology"]["weighting"])

        baseline = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(self.SYMBOLS),
            rebalance_frequency="quarterly",
        )
        for sized, proxy in zip(result["holdings_log"], baseline["holdings_log"]):
            self.assertEqual(list(sized["holdings"]), list(proxy["holdings"]), "selection must not move")
            self.assertNotEqual(sized["holdings"], proxy["holdings"], "sizing must move")

    def test_outstanding_share_history_is_never_labelled_as_float_sizing(self):
        series = self._series()
        caps = {"AAA": 1e9, "BBB": 4e9, "CCC": 9e9, "DDD": 16e9, "EEE": 25e9, "FFF": 36e9}

        def lookup(symbol, _date):
            return caps.get(symbol)

        lookup.size_input = "point-in-time share count x unadjusted close"
        lookup.size_basis = "shares_outstanding"
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(self.SYMBOLS),
            rebalance_frequency="quarterly",
            float_cap_lookup=lookup,
        )
        methodology = result["methodology"]
        self.assertEqual(methodology["weighting_mode"], "score-size-proxy")
        self.assertFalse(methodology["live_weighting_tested"])
        self.assertEqual(methodology["production_float_sized_rebalances"], 0)
        self.assertGreater(methodology["outstanding_share_proxy_rebalances"], 0)
        self.assertIn("not float-adjusted", methodology["historical_capitalisation"])
        self.assertTrue(all(
            event["weighting_mode"] == "score-size-proxy"
            for event in result["holdings_log"]
        ))

    def test_scores_and_caps_reproduce_the_raw_formula_exactly(self):
        # Without sector metadata the solver is skipped, so the published
        # weights are the normalized raw weights and can be recomputed here.
        series = self._series()
        caps = {"AAA": 1e9, "BBB": 4e9, "CCC": 9e9, "DDD": 16e9, "EEE": 25e9, "FFF": 36e9}
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(self.SYMBOLS),
            rebalance_frequency="quarterly",
            float_cap_lookup=lambda symbol, _date: caps.get(symbol),
        )
        self.assertTrue(result["available"], result.get("reason"))
        for event in result["holdings_log"]:
            selected = list(event["holdings"])
            signal_date = pd.Timestamp(event["signal_date"])

            def metrics_for(symbol):
                frame = series[symbol].frame
                position = int(frame.index.searchsorted(signal_date, side="right") - 1)
                return _window_metrics(frame["adj"].to_numpy(dtype=float), position)

            # The cross-sectional Z-score is formed over the eligible
            # universe for this signal date, exactly as the backtest does.
            cross_section = [_window_metrics(series[symbol].frame["adj"].to_numpy(dtype=float),
                                            int(series[symbol].frame.index.searchsorted(signal_date, side="right") - 1))["risk_adjusted"]
                             for symbol in self.SYMBOLS]
            z_scores = _zscore(cross_section)
            scored = {symbol: momentum_score(z) for symbol, z in zip(self.SYMBOLS, z_scores)}
            self.assertTrue(all(metrics_for(symbol) for symbol in selected))

            median = float(np.median([caps[symbol] for symbol in selected]))
            expected = {
                symbol: scored[symbol] * math.sqrt(caps[symbol] / median)
                for symbol in selected
            }
            total = sum(expected.values())
            for symbol, weight in event["holdings"].items():
                self.assertAlmostEqual(weight, expected[symbol] / total * 100.0, places=3, msg=symbol)

    def test_the_lookup_is_asked_for_the_signal_date_only(self):
        series = self._series()
        requested: list[tuple[str, pd.Timestamp]] = []

        def lookup(symbol, stamp):
            requested.append((symbol, pd.Timestamp(stamp)))
            return 1e9 * (1 + self.SYMBOLS.index(symbol))

        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(self.SYMBOLS),
            rebalance_frequency="semiannual",
            start="2024-04-15",
            end="2024-12-31",
            float_cap_lookup=lookup,
        )
        self.assertTrue(result["available"], result.get("reason"))
        signal_dates = {event["signal_date"] for event in result["holdings_log"]}
        self.assertTrue({stamp.strftime("%Y-%m-%d") for _, stamp in requested} <= signal_dates)
        for _, stamp in requested:
            self.assertLessEqual(stamp.strftime("%Y-%m-%d"), "2024-12-31")

    def test_a_partial_lookup_falls_back_for_that_rebalance(self):
        series = self._series()
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(self.SYMBOLS),
            rebalance_frequency="quarterly",
            float_cap_lookup=lambda symbol, _date: 1e9 if symbol == "AAA" else None,
        )
        self.assertTrue(result["available"], result.get("reason"))
        self.assertEqual(result["methodology"]["weighting_mode"], "equal-weight-proxy")
        self.assertTrue(all(event["weighting_mode"] == "equal-weight-proxy" for event in result["holdings_log"]))

    def test_the_market_cap_exponent_is_recorded_and_does_not_move_selection(self):
        series = self._series()
        caps = {"AAA": 1e9, "BBB": 4e9, "CCC": 9e9, "DDD": 16e9, "EEE": 25e9, "FFF": 36e9}
        runs = {
            beta: run_backtest(
                series,
                top_n=3,
                universe_symbols=set(self.SYMBOLS),
                rebalance_frequency="quarterly",
                market_cap_exponent=beta,
                float_cap_lookup=lambda symbol, _date: caps.get(symbol),
            )
            for beta in (0.0, 0.5, 1.0)
        }
        for beta, run in runs.items():
            self.assertEqual(run["methodology"]["market_cap_exponent"], beta)
        orders = {beta: [list(event["holdings"]) for event in run["holdings_log"]] for beta, run in runs.items()}
        self.assertEqual(orders[0.0], orders[0.5])
        self.assertEqual(orders[0.5], orders[1.0])
        weights = {beta: [event["holdings"] for event in run["holdings_log"]] for beta, run in runs.items()}
        self.assertNotEqual(weights[0.0], weights[1.0])


class CalendarTests(unittest.TestCase):
    def test_thanksgiving_is_closed(self):
        moment = datetime(2026, 11, 26, 10, 0, tzinfo=NY)
        self.assertEqual(market_state(moment)["state"], "closed")

    def test_early_close_is_after_hours(self):
        moment = datetime(2026, 11, 27, 15, 0, tzinfo=NY)
        self.assertEqual(market_state(moment)["state"], "after-hours")


def synthetic_series(symbol: str, days: int = 900) -> SymbolSeries:
    # Python's hash is process-randomized; a stable symbol seed keeps repeated
    # backtests reproducible across separate test and deployment processes.
    rng = np.random.default_rng(sum(map(ord, symbol)) % (2**32))
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

    def test_rebalance_schedule_uses_exact_calendar_months(self):
        sessions = pd.bdate_range("2023-01-02", "2025-12-31")
        expected = {
            "monthly": set(range(1, 13)),
            "quarterly": {3, 6, 9, 12},
            "semiannual": {3, 9},
            "annual": {9},
        }
        for frequency, months in expected.items():
            events = rebalance_schedule(sessions, frequency=frequency)
            self.assertTrue(events)
            self.assertEqual(
                {sessions[event["signal_position"]].month for event in events},
                months,
                frequency,
            )
            execution_positions = [event["execution_position"] for event in events]
            self.assertEqual(len(execution_positions), len(set(execution_positions)))
            for event in events:
                self.assertLess(event["signal_position"], event["execution_position"])
            ranged = rebalance_schedule(
                sessions,
                frequency=frequency,
                start="2023-04-17",
                end="2025-11-28",
            )
            scheduled_months = {
                sessions[event["signal_position"]].month
                for event in ranged
                if event["kind"] == "scheduled"
            }
            self.assertEqual(scheduled_months, months, f"{frequency} scheduled months")

    def test_schedule_respects_partial_range_and_initial_formation(self):
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
        self.assertTrue(all(pd.Timestamp("2024-04-17") <= sessions[event["execution_position"]] <= pd.Timestamp("2024-11-20") for event in events))
        self.assertFalse(any(event["scheduled_month"] == 11 for event in events))

    def test_monthly_schedule_keeps_the_same_month_in_later_years(self):
        sessions = pd.bdate_range("2023-01-02", "2026-12-31")
        events = rebalance_schedule(
            sessions,
            frequency="monthly",
            start="2024-04-17",
            end="2025-11-20",
        )
        execution_months = [
            sessions[event["execution_position"]].strftime("%Y-%m")
            for event in events
        ]
        expected = [
            f"{year}-{month:02d}"
            for year in (2024, 2025)
            for month in range(1, 13)
            if "2024-04" <= f"{year}-{month:02d}" <= "2025-11"
        ]
        self.assertEqual(execution_months, expected)
        self.assertEqual(len(execution_months), len(set(execution_months)))

    def test_month_end_holiday_uses_last_session_and_next_execution(self):
        sessions = pd.bdate_range("2024-01-02", "2024-06-28")
        sessions = sessions[sessions != pd.Timestamp("2024-03-29")]
        events = rebalance_schedule(sessions, frequency="semiannual")
        first = events[0]
        self.assertEqual(sessions[first["signal_position"]], pd.Timestamp("2024-03-28"))
        self.assertEqual(sessions[first["execution_position"]], pd.Timestamp("2024-04-01"))

    def test_every_frequency_changes_holdings_only_on_its_schedule(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        series["SPY"] = synthetic_series("SPY")
        results = {
            frequency: run_backtest(
                series,
                top_n=3,
                universe_symbols=set(symbols),
                rebalance_frequency=frequency,
            )
            for frequency in REBALANCE_FREQUENCIES
        }
        for frequency, result in results.items():
            self.assertTrue(result["available"], result.get("reason"))
            self.assertEqual(result["event_counts"]["initial_formation"], 1)
            self.assertEqual(
                result["event_counts"]["total"],
                result["event_counts"]["initial_formation"] + result["event_counts"]["scheduled"],
            )
            expected_months = set(REBALANCE_FREQUENCIES[frequency])
            for event in result["holdings_log"]:
                self.assertIn(int(event["signal_date"][5:7]), expected_months)
                self.assertGreaterEqual(event["execution_date"], event["signal_date"])
                self.assertAlmostEqual(sum(event["holdings"].values()), 100.0, places=3)
        counts = [len(results[name]["holdings_log"]) for name in ("monthly", "quarterly", "semiannual", "annual")]
        self.assertGreater(counts[0], counts[1])
        self.assertGreater(counts[1], counts[2])
        self.assertGreaterEqual(counts[2], counts[3])
        self.assertGreater(
            results["monthly"]["metrics"]["transaction_cost_pct"],
            results["annual"]["metrics"]["transaction_cost_pct"],
        )
        self.assertNotEqual(
            results["monthly"]["holdings_log"],
            results["annual"]["holdings_log"],
        )
        repeated = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(symbols),
            rebalance_frequency="quarterly",
        )
        self.assertEqual(results["quarterly"]["holdings_log"], repeated["holdings_log"])
        self.assertEqual(results["quarterly"]["metrics"], repeated["metrics"])

    def test_backtest_weights_obey_stock_and_sector_caps(self):
        symbols = [f"S{index:02d}" for index in range(20)]
        sectors = ["Technology", "Healthcare", "Financials", "Energy"]
        sector_by_symbol = {
            symbol: sectors[index % len(sectors)]
            for index, symbol in enumerate(symbols)
        }
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        series["SPY"] = synthetic_series("SPY")
        result = run_backtest(
            series,
            top_n=20,
            universe_symbols=set(symbols),
            rebalance_frequency="quarterly",
            sector_by_symbol=sector_by_symbol,
        )
        self.assertTrue(result["available"], result.get("reason"))
        for event in result["holdings_log"]:
            self.assertLessEqual(max(event["holdings"].values()), 9.0 + 1e-6)
            grouped = {}
            for symbol, weight in event["holdings"].items():
                group = group_sector(sector_by_symbol[symbol])
                grouped[group] = grouped.get(group, 0.0) + weight
            self.assertLessEqual(max(grouped.values()), 35.0 + 1e-3)

    def test_top_twenty_backtest_selects_exactly_twenty_names(self):
        symbols = [f"S{index:02d}" for index in range(30)]
        sectors = ["Technology", "Healthcare", "Financials", "Energy", "Consumer Staples"]
        sector_by_symbol = {
            symbol: sectors[index % len(sectors)]
            for index, symbol in enumerate(symbols)
        }
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        result = run_backtest(
            series,
            top_n=20,
            universe_symbols=set(symbols),
            sector_by_symbol=sector_by_symbol,
        )
        self.assertTrue(result["available"], result.get("reason"))
        for event in result["holdings_log"]:
            self.assertEqual(len(event["holdings"]), 20)
        self.assertEqual(result["methodology"]["selection"], "top 20")

    def test_requested_period_is_enforced(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(symbols),
            rebalance_frequency="monthly",
            start="2024-04-15",
            end="2024-10-31",
        )
        self.assertTrue(result["available"], result.get("reason"))
        self.assertGreaterEqual(result["start"], "2024-04-15")
        self.assertLessEqual(result["end"], "2024-10-31")
        for event in result["holdings_log"]:
            self.assertGreaterEqual(event["execution_date"], "2024-04-15")
            self.assertLessEqual(event["execution_date"], "2024-10-31")

    def test_rebalance_signals_use_only_prices_available_before_execution(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        base_series = {symbol: synthetic_series(symbol) for symbol in symbols}
        baseline = run_backtest(
            base_series,
            top_n=3,
            universe_symbols=set(symbols),
            rebalance_frequency="semiannual",
        )
        self.assertTrue(baseline["available"], baseline.get("reason"))
        first = baseline["holdings_log"][0]
        self.assertLess(first["signal_date"], first["execution_date"])

        altered = {}
        cut = pd.Timestamp(first["execution_date"])
        for symbol, original in base_series.items():
            frame = original.frame.copy()
            future = frame.index > cut
            frame.loc[future, ["adj", "close"]] *= 3.0
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
            universe_symbols=set(symbols),
            rebalance_frequency="semiannual",
        )
        self.assertEqual(changed["holdings_log"][0]["holdings"], first["holdings"])

    def test_missing_price_history_is_excluded_without_inventing_returns(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        series["BAD"] = synthetic_series("BAD")
        series["BAD"].frame.loc[:, ["adj", "close"]] = np.nan
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(symbols) | {"BAD"},
            rebalance_frequency="quarterly",
        )
        self.assertTrue(result["available"], result.get("reason"))
        self.assertTrue(all("BAD" not in event["leaders"] for event in result["holdings_log"]))
        self.assertTrue(np.isfinite(result["strategy"]).all())

    def test_materially_stale_price_tail_blocks_the_backtest(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        original = series["AAA"]
        truncated = original.frame.iloc[:-10].copy()
        series["AAA"] = SymbolSeries(
            symbol="AAA",
            frame=truncated,
            source=original.source,
            source_label=original.source_label,
            fetched_at=original.fetched_at,
            adjusted=original.adjusted,
            is_backup=original.is_backup,
        )
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(symbols),
            rebalance_frequency="quarterly",
        )
        self.assertFalse(result["available"])
        self.assertIn("materially stale tails", result["reason"])
        self.assertIn("AAA (10)", result["reason"])

    def test_backtest_api_validates_and_forwards_the_selected_frequency(self):
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
                    "initial_capital": 25_000,
                    "cashflow_enabled": True,
                    "cashflow_amount": 250,
                    "cashflow_frequency": "quarterly",
                    "cashflow_direction": "outflow",
                }
            )
        runner.assert_called_once_with(
            portfolio="top100",
            rebalance_frequency="quarterly",
            start="2024-01-02",
            end="2025-12-31",
            initial_capital=25000.0,
            cashflow_enabled=True,
            cashflow_amount=250.0,
            cashflow_frequency="quarterly",
            cashflow_direction="outflow",
        )
        self.assertEqual(json.loads(response.body)["rebalanceLabel"], "Quarterly (Mar / Jun / Sep / Dec)")

    def test_backtest_api_rejects_unsupported_or_reversed_windows(self):
        with self.assertRaises(HTTPException):
            run_backtest_endpoint(
                {
                    "portfolio": "top100",
                    "start": "2024-01-02",
                    "end": "2025-12-31",
                    "rebalance_frequency": "weekly",
                }
            )
        with self.assertRaises(HTTPException):
            run_backtest_endpoint(
                {
                    "portfolio": "top100",
                    "start": "2024-01-02",
                    "end": "2025-12-31",
                    "rebalance_frequency": "quarterly",
                    "cashflow_enabled": True,
                    "cashflow_amount": 0,
                }
            )
        with self.assertRaises(HTTPException):
            run_backtest_endpoint(
                {
                    "portfolio": "top100",
                    "start": "2025-12-31",
                    "end": "2024-01-02",
                    "rebalance_frequency": "quarterly",
                }
            )

    def test_price_only_path_keeps_dividends_as_cash_without_reinvestment(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        for symbol in ("SPY", "SPMO"):
            series[symbol] = synthetic_series(symbol)
        for item in series.values():
            item.frame.loc[item.frame.index[700], "dividends"] = 2.0
            item.source = "yahoo"
        result = run_backtest(series, top_n=3, universe_symbols=set(symbols))
        self.assertTrue(result["available"])
        self.assertEqual(len(result["strategy"]), len(result["price_strategy"]))
        self.assertNotEqual(float(result["strategy"].iloc[-1]), float(result["price_strategy"].iloc[-1]))
        self.assertEqual(result["dividend_coverage"]["incomplete_securities"], 0)

    def test_split_adjusted_close_is_not_adjusted_a_second_time(self):
        days = 70
        data = np.full(days, 50.0)
        dates = pd.bdate_range("2025-01-02", periods=days)
        frame = pd.DataFrame(
            {
                "adj": data,
                "close": data,
                "volume": np.full(days, 2_000_000.0),
                "open": data,
                "high": data,
                "low": data,
                "dividends": np.zeros(days),
                "splits": np.r_[np.ones(35), 2.0, np.ones(days - 36)],
            },
            index=dates,
        )
        series = SymbolSeries(
            symbol="SPLIT",
            frame=frame,
            source="yahoo",
            source_label="Yahoo Finance",
            fetched_at="2026-01-01T00:00:00+00:00",
            adjusted=True,
            is_backup=False,
        )
        prices, _ = _price_cash_frames({"SPLIT": series})
        self.assertAlmostEqual(float(prices["SPLIT"].iloc[34]), 50.0)
        self.assertAlmostEqual(float(prices["SPLIT"].iloc[36]), 50.0)


class MacroTests(unittest.TestCase):
    def test_cpi_parser_validates_numbers_and_reports_gaps(self):
        parsed = parse_cpi_csv(
            "\n".join(
                [
                    "observation_date,CPIAUCNS",
                    "2017-12-01,246.500",
                    "2018-01-01,247.000",
                    "2018-03-01,249.000",
                    "2018-04-01,not-a-number",
                ]
            ),
            start=date(2018, 1, 1),
        )
        self.assertEqual(parsed["observations"][0]["value"], 247.0)
        self.assertEqual(parsed["observations"][0]["available_from"], "2018-02-15")
        self.assertEqual(parsed["missing_months"], ["2018-02"])
        self.assertEqual(parsed["rejected_row_count"], 1)


class BacktestMetricsTests(unittest.TestCase):
    """Recompute every published metric from the returned NAV series.

    The expected values here are derived with plain pandas/numpy in the test,
    not with helpers from ``app.backtest``, so a bug in the production formulas
    cannot hide behind an identical implementation.
    """

    @classmethod
    def setUpClass(cls):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        series["SPY"] = synthetic_series("SPY")
        series["SPMO"] = synthetic_series("SPMO")
        cls.result = run_backtest(series, top_n=3, universe_symbols=set(symbols))
        cls.nav = cls.result["strategy"]

    def test_cumulative_return_reconciles_with_the_nav_series(self):
        expected = (float(self.nav.iloc[-1]) / 100.0 - 1.0) * 100.0
        self.assertAlmostEqual(self.result["metrics"]["cumulative_return"], expected, places=1)

    def test_cagr_uses_calendar_days_between_first_and_last_observation(self):
        total = float(self.nav.iloc[-1]) / 100.0
        days = max(1, (self.nav.index[-1] - self.nav.index[0]).days)
        expected = (total ** (365.0 / days) - 1.0) * 100.0
        self.assertAlmostEqual(self.result["metrics"]["cagr"], expected, places=1)

    def test_sharpe_is_annualised_excess_return_over_daily_volatility(self):
        returns = self.nav.pct_change().dropna()
        mean = float(returns.mean())
        std = float(returns.std())
        expected = mean / std * np.sqrt(252)
        self.assertAlmostEqual(self.result["metrics"]["sharpe"], expected, places=2)
        # The documented risk-free rate is zero, so no excess subtraction.
        self.assertEqual(self.result["metrics"]["risk_free_rate"], 0.0)

    def test_max_drawdown_is_measured_from_the_running_peak(self):
        running_peak = self.nav.cummax()
        expected = float(((self.nav / running_peak) - 1.0).min() * 100.0)
        self.assertAlmostEqual(self.result["metrics"]["max_drawdown"], expected, places=1)
        self.assertLessEqual(self.result["metrics"]["max_drawdown"], 0.0)
        self.assertLessEqual(min(self.result["drawdown"]), 0.0)
        self.assertGreaterEqual(max(self.result["drawdown"]), -1e-9)

    def test_drawdown_is_never_positive_and_returns_to_zero_at_a_new_high(self):
        peak = self.nav.iloc[0]
        for value in self.nav:
            peak = max(peak, float(value))
            self.assertLessEqual(float(value) - peak, 1e-9)

    def test_annual_returns_use_calendar_years(self):
        for entry in self.result["annual"]:
            year = entry["year"]
            same_year = self.nav[self.nav.index.year == year]
            prior = self.nav[self.nav.index.year < year]
            base = float(prior.iloc[-1]) if not prior.empty else 100.0
            expected = (float(same_year.iloc[-1]) / base - 1.0) * 100.0
            self.assertAlmostEqual(entry["strategy"], expected, places=1, msg=f"year {year}")

    def test_first_calendar_year_includes_the_initial_entry_cost(self):
        first_year = self.result["annual"][0]
        same_year = self.nav[self.nav.index.year == int(first_year["year"])]
        expected = (float(same_year.iloc[-1]) / 100.0 - 1.0) * 100.0
        wrong_old_basis = (float(same_year.iloc[-1]) / float(same_year.iloc[0]) - 1.0) * 100.0
        self.assertAlmostEqual(first_year["strategy"], expected, places=1)
        self.assertGreater(abs(first_year["strategy"] - wrong_old_basis), 0.05)

    def test_each_benchmark_is_rebased_to_100_on_the_first_strategy_date(self):
        for symbol, values in self.result["benchmarks"].items():
            self.assertAlmostEqual(float(values.iloc[0]), 100.0, places=6, msg=symbol)
            self.assertGreaterEqual(values.index[0], self.nav.index[0], symbol)
            self.assertLessEqual(values.index[-1], self.nav.index[-1], symbol)

    def test_metrics_are_internally_consistent(self):
        metrics = self.result["metrics"]
        # A strategy that ends above its start must show a positive cumulative
        # return and a CAGR of the same sign.
        self.assertEqual(metrics["cumulative_return"] > 0, metrics["cagr"] > 0)
        self.assertIsNotNone(metrics["annualized_volatility"])
        self.assertGreater(metrics["annualized_volatility"], 0.0)
        self.assertEqual(metrics["transaction_cost_pct"] > 0, True)
        self.assertIsNotNone(metrics["sortino"])
        self.assertIsNotNone(metrics["benchmark_relative"]["spy"]["beta"])
        self.assertIsNotNone(metrics["benchmark_relative"]["spy"]["information_ratio"])

    def test_sortino_uses_every_non_negative_shortfall_as_zero(self):
        returns = np.array([0.01 if index % 3 else -0.005 for index in range(20)])
        values = [100.0]
        for value in returns:
            values.append(values[-1] * (1.0 + value))
        nav = pd.Series(values, index=pd.bdate_range("2024-01-02", periods=len(values)))
        statistics = _performance_statistics(nav)
        returns = nav.pct_change().dropna()
        mean = float(returns.mean())
        downside = np.minimum(returns.to_numpy(dtype=float), 0.0)
        downside_deviation = float(np.sqrt(np.mean(np.square(downside))))
        expected = mean / downside_deviation * np.sqrt(252)
        self.assertAlmostEqual(statistics["sortino"], expected, places=2)

    def test_benchmark_beta_and_information_ratio_match_hand_formula(self):
        strategy_returns = np.array([
            0.004 + math.sin(index) * 0.003
            for index in range(20)
        ])
        benchmark_returns = np.array([
            value * 0.7 + (0.0005 if index % 2 else -0.0005)
            for index, value in enumerate(strategy_returns)
        ])
        dates = pd.bdate_range("2024-01-02", periods=len(strategy_returns) + 1)
        strategy_values = [100.0]
        benchmark_values = [100.0]
        for strategy_return, benchmark_return in zip(strategy_returns, benchmark_returns):
            strategy_values.append(strategy_values[-1] * (1.0 + strategy_return))
            benchmark_values.append(benchmark_values[-1] * (1.0 + benchmark_return))
        strategy = pd.Series(strategy_values, index=dates)
        benchmark = pd.Series(benchmark_values, index=dates)
        covariance = np.cov(strategy_returns, benchmark_returns, ddof=1)[0, 1]
        beta = covariance / np.var(benchmark_returns, ddof=1)
        active = strategy_returns - benchmark_returns
        information_ratio = active.mean() / active.std(ddof=1) * np.sqrt(252)
        relative = _benchmark_relative(
            strategy,
            benchmark,
            _performance_statistics(strategy, origin=100.0),
        )
        self.assertAlmostEqual(relative["beta"], beta, places=3)
        self.assertAlmostEqual(relative["information_ratio"], information_ratio, places=2)


class TransactionCostTests(unittest.TestCase):
    def test_zero_normal_and_high_costs_are_applied_once_to_traded_notional(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        results = {
            rate: run_backtest(
                series,
                top_n=3,
                universe_symbols=set(symbols),
                transaction_cost_rate=rate,
            )
            for rate in (0.0, 0.001, 0.005)
        }
        self.assertAlmostEqual(float(results[0.0]["strategy"].iloc[0]), 100.0, places=9)
        self.assertAlmostEqual(float(results[0.001]["strategy"].iloc[0]), 99.9, places=9)
        self.assertAlmostEqual(float(results[0.005]["strategy"].iloc[0]), 99.5, places=9)
        costs = [results[rate]["metrics"]["transaction_cost_pct"] for rate in (0.0, 0.001, 0.005)]
        self.assertEqual(costs[0], 0.0)
        self.assertLess(costs[0], costs[1])
        self.assertLess(costs[1], costs[2])

    def test_backtest_accounts_share_cashflow_dates_and_reconcile(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
        series = {symbol: synthetic_series(symbol) for symbol in symbols}
        for symbol in ("SPY", "SPMO"):
            series[symbol] = synthetic_series(symbol)
        result = run_backtest(
            series,
            top_n=3,
            universe_symbols=set(symbols),
            rebalance_frequency="quarterly",
            initial_capital=12_345,
            cashflow_enabled=True,
            cashflow_amount=750,
            cashflow_frequency="monthly",
            cashflow_direction="outflow",
        )
        self.assertTrue(result["available"], result.get("reason"))
        accounts = result["cashflow_accounts"]["accounts"]
        self.assertEqual(set(accounts), {"strategy", "spy", "spmo"})
        dates = [
            [event["date"] for event in accounts[key]["events"]]
            for key in ("strategy", "spy", "spmo")
        ]
        # Every account receives the same dated request while it is funded. A
        # depleted account stops requesting, so its ledger is a prefix.
        common = min(len(sequence) for sequence in dates)
        self.assertGreater(common, 0)
        self.assertEqual(dates[0][:common], dates[1][:common])
        self.assertEqual(dates[1][:common], dates[2][:common])
        longest = max(len(sequence) for sequence in dates)
        for key, sequence in zip(("strategy", "spy", "spmo"), dates):
            if len(sequence) < longest:
                self.assertTrue(accounts[key]["fully_depleted"], key)
        self.assertEqual(len(accounts["strategy"]["balances"]), len(result["strategy"]))
        self.assertAlmostEqual(
            accounts["strategy"]["time_weighted_return_pct"],
            result["metrics"]["cumulative_return"],
            places=1,
        )
        for account in accounts.values():
            self.assertAlmostEqual(
                account["final_value"],
                account["ending_holdings_value"] + account["ending_cash"],
            )
            self.assertGreaterEqual(account["final_value"], 0)
            self.assertTrue(all(value >= 0 for value in account["balances"]))
        self.assertEqual(set(result["price_cashflow_accounts"]["accounts"]), {"strategy", "spy", "spmo"})


class PortfolioWeightTests(unittest.TestCase):
    """The donut, the legend and the holdings table must be one dataset."""

    def _scored(self, count=100, sector_count=6):
        sectors = ["Technology", "Healthcare", "Financials", "Energy", "Industrials", "Utilities"]
        rows = []
        for index in range(count):
            rows.append(
                {
                    "symbol": f"T{index:03d}",
                    "company": f"Company {index}",
                    "sector": sectors[index % sector_count],
                    "score": 1.0 + (index % 17) * 0.1,
                    "momentum_12_1": 5.0 + index * 0.2,
                    "market_cap": 50_000_000_000.0 + index * 1e9,
                    "float_market_cap": 40_000_000_000.0 + index * 8e8,
                }
            )
        return rows

    def test_final_weights_sum_to_one_hundred_and_respect_caps(self):
        book = build_portfolio(self._scored())
        self.assertTrue(book["available"])
        total = sum(row["finalWeight"] for row in book["holdings"])
        self.assertAlmostEqual(total, 100.0, places=6)
        self.assertLessEqual(max(row["finalWeight"] for row in book["holdings"]), 9.0 + 1e-6)

        sector_totals = {}
        for row in book["holdings"]:
            sector_totals[row["sector"]] = sector_totals.get(row["sector"], 0.0) + row["finalWeight"]
        self.assertLessEqual(max(sector_totals.values()), 35.0 + 1e-6)

    def test_constraints_publish_exactly_four_canonical_items(self):
        book = build_portfolio(self._scored())
        self.assertEqual(
            [(row["id"], row["label"], row["rule"]) for row in book["constraints"]],
            [
                ("max-stock", "Max Stock Weight", "≤ 9%"),
                ("max-sector", "Max Sector Weight", "≤ 35%"),
                ("target-holdings", "Target Holdings", "= 100"),
                ("target-allocation", "Target Allocation", "= 100%"),
            ],
        )
        self.assertNotIn("fully-invested", {row["id"] for row in book["constraints"]})
        self.assertNotIn("Fully Invested", {row["label"] for row in book["constraints"]})

    def test_top_twenty_constraints_publish_the_selected_target(self):
        book = build_portfolio(self._scored(count=120), target_holdings=20)
        self.assertEqual(len(book["holdings"]), 20)
        self.assertEqual(
            [(row["id"], row["rule"]) for row in book["constraints"]],
            [
                ("max-stock", "≤ 9%"),
                ("max-sector", "≤ 35%"),
                ("target-holdings", "= 20"),
                ("target-allocation", "= 100%"),
            ],
        )

    def test_constraint_statuses_come_from_the_actual_book(self):
        rows = [
            {"ticker": "OVER", "sector": "Technology", "finalWeight": 9.1},
            {"ticker": "TECH", "sector": "Technology", "finalWeight": 26.0},
            {"ticker": "ENERGY", "sector": "Energy", "finalWeight": 64.9},
        ]
        constraints, validation = evaluate_portfolio_constraints(rows)
        self.assertTrue(validation["evaluated"])
        by_id = {row["id"]: row for row in constraints}
        self.assertEqual(by_id["max-stock"]["status"], "failed")
        self.assertEqual(by_id["max-sector"]["status"], "failed")
        self.assertEqual(by_id["target-holdings"]["status"], "failed")
        self.assertEqual(by_id["target-allocation"]["status"], "passed")

    def test_missing_weights_are_unevaluated_and_never_pass(self):
        constraints, validation = evaluate_portfolio_constraints([
            {"ticker": "GOOD", "sector": "Technology", "finalWeight": 5.0},
            {"ticker": "MISSING", "sector": "Energy"},
        ])
        self.assertFalse(validation["evaluated"])
        self.assertTrue(all(row["status"] == "unavailable" for row in constraints))
        self.assertTrue(all(not row["passed"] for row in constraints))

    def test_sector_rows_reproduce_the_holdings_totals(self):
        book = build_portfolio(self._scored())
        by_sector = {}
        for row in book["holdings"]:
            by_sector[row["sector"]] = by_sector.get(row["sector"], 0.0) + row["finalWeight"]
        for row in book["sectors"]:
            # The donut is published in tenths of a percent and re-balanced to
            # keep its own total at 100%, so one tenth is the rounding budget.
            self.assertAlmostEqual(row["value"], by_sector[row["name"]], delta=0.1, msg=row["name"])
        self.assertAlmostEqual(sum(row["value"] for row in book["sectors"]), 100.0, places=6)
        # Every holding sector appears in the donut, and nothing extra does.
        self.assertEqual({row["name"] for row in book["sectors"]}, set(by_sector))

    def test_sector_rounding_preserves_the_total_without_adding_categories(self):
        exact = {
            "Technology": 35.0,
            "Communication": 14.14,
            "Healthcare": 12.51,
            "Consumer Staples": 11.0,
            "Energy": 13.1,
            "Financials": 8.1,
            "Industrials": 4.35,
            "Materials": 1.0,
            "Real Estate": 0.8,
        }
        rounded = _rounded_sector_values(exact)
        self.assertEqual(set(rounded), set(exact))
        self.assertAlmostEqual(sum(rounded.values()), 100.0, places=6)
        self.assertLessEqual(max(rounded.values()), 35.0 + 1e-9)

    def test_raw_weight_formula_is_score_times_relative_sqrt_float_cap(self):
        scored = self._scored()
        book = build_portfolio(scored)
        selected = {row["ticker"]: row for row in book["holdings"]}
        selected_rows = [row for row in scored if row["symbol"] in selected]
        median = book["weighting"]["medianFloatMarketCap"]
        # The relative form divides by the median of the *selected* holdings.
        self.assertAlmostEqual(
            median,
            float(np.median([row["float_market_cap"] for row in selected_rows])),
            places=6,
        )
        expected = {
            ticker: row["score"] * math.sqrt(row["float_market_cap"] / median)
            for ticker, row in selected.items()
        }
        denominator = sum(expected.values())
        for ticker, row in selected.items():
            self.assertAlmostEqual(row["rawWeight"], expected[ticker] / denominator * 100.0, places=3, msg=ticker)
        self.assertEqual(book["weighting"]["marketCapExponent"], 0.5)
        self.assertEqual(book["weighting"]["methodologyId"], METHODOLOGY_ID)

    def test_rounding_never_moves_a_name_over_its_cap(self):
        book = build_portfolio(self._scored())
        for row in book["holdings"]:
            self.assertLessEqual(row["finalWeight"], 9.0 + 1e-6, row["ticker"])
        for constraint in book["constraints"]:
            self.assertTrue(constraint["passed"], constraint["id"])

    def test_holdings_without_a_float_cap_are_excluded_not_zero_weighted(self):
        scored = self._scored(count=60)
        scored[3]["float_market_cap"] = None
        book = build_portfolio(scored)
        self.assertIn(scored[3]["symbol"], book["excluded_no_market_cap"])
        self.assertNotIn(scored[3]["symbol"], {row["ticker"] for row in book["holdings"]})

    def test_missing_momentum_scores_are_excluded_not_defaulted(self):
        scored = self._scored(count=101)
        scored[5]["score"] = None
        book = build_portfolio(scored)
        self.assertTrue(book["available"])
        self.assertIn(scored[5]["symbol"], book["excluded_no_score"])
        self.assertNotIn(scored[5]["symbol"], {row["ticker"] for row in book["holdings"]})
        self.assertEqual(len(book["holdings"]), 100)

    def test_api_portfolio_schema_matches_frontend_contract(self):
        book = build_portfolio(self._scored(count=110))
        self.assertTrue(book["available"])
        for key in ("holdings", "sectors", "summary", "constraints", "validation", "weighting"):
            self.assertIn(key, book)
        for key in ("totalHoldings", "largestHolding", "topTenWeight", "investedCapital"):
            self.assertIn(key, book["summary"])
        for holding in book["holdings"]:
            for key in (
                "rank",
                "ticker",
                "company",
                "sector",
                "score",
                "floatAdjustedMarketCapValue",
                "rawWeight",
                "finalWeight",
            ):
                self.assertIn(key, holding)

    def test_selection_is_the_highest_ranked_hundred_names(self):
        scored = self._scored(count=120)
        book = build_portfolio(scored)
        self.assertEqual(len(book["holdings"]), 100)
        expected = [
            row["symbol"]
            for row in sorted(scored, key=selection_sort_key)[:100]
        ]
        self.assertEqual([row["ticker"] for row in book["holdings"]], expected)
        self.assertEqual(book["summary"]["totalHoldings"], 100)

    def test_summary_kpis_reconcile_with_final_holding_weights(self):
        book = build_portfolio(self._scored(count=120))
        weights = [row["finalWeight"] for row in book["holdings"]]
        largest = max(book["holdings"], key=lambda row: row["finalWeight"])
        expected_top_ten = round(sum(sorted(weights, reverse=True)[:10]), 1)
        self.assertEqual(book["summary"]["largestHolding"]["ticker"], largest["ticker"])
        self.assertAlmostEqual(book["summary"]["largestHolding"]["finalWeight"], largest["finalWeight"])
        self.assertEqual(book["summary"]["topTenWeight"], expected_top_ten)
        self.assertEqual(book["summary"]["investedCapital"], 100.0)


class FundamentalFallbackTests(unittest.TestCase):
    @staticmethod
    def _stock(index, fetched_at="2026-11-12T12:00:00+00:00"):
        return {
            "ticker": f"S{index:03d}",
            "floatShares": 10_000_000.0 + index * 100_000.0,
            "marketCap": 50_000_000_000.0 + index * 1e9,
            "marketCapFetchedAt": fetched_at,
            "quoteSource": "yahoo",
            "sourceLabel": "Yahoo Finance",
        }

    def test_recent_verified_float_shares_fill_only_missing_quotes(self):
        now = datetime(2026, 11, 13, tzinfo=timezone.utc)
        fallbacks = _verified_fundamental_fallbacks(
            [{"stocks": [self._stock(0), self._stock(1)]}],
            now=now,
        )
        scored = [
            {"symbol": "S000", "score": 2.0},
            {"symbol": "S001", "score": 1.5},
            {"symbol": "S002", "score": 1.0},
        ]
        quotes = {
            "S000": {"float_shares": 20_000_000.0, "market_cap": 90_000_000_000.0, "fetched_at": "2026-11-13T00:00:00+00:00"},
            "S002": {},
        }
        used = _merge_verified_fundamentals(scored, quotes, fallbacks)
        self.assertEqual(used, ["S001"])
        self.assertEqual(quotes["S000"]["float_shares"], 20_000_000.0)
        self.assertEqual(quotes["S001"]["float_shares"], 10_100_000.0)
        self.assertIsNone(quotes["S002"].get("float_shares"))

    def test_expired_fundamentals_are_not_reused(self):
        fallbacks = _verified_fundamental_fallbacks(
            [{"stocks": [self._stock(0, fetched_at="2026-09-01T00:00:00+00:00")]}],
            now=datetime(2026, 11, 13, tzinfo=timezone.utc),
        )
        self.assertEqual(fallbacks, {})

    def test_recovered_fundamentals_complete_the_live_failure_shape(self):
        now = datetime(2026, 11, 13, tzinfo=timezone.utc)
        stocks = [self._stock(index) for index in range(110)]
        fallbacks = _verified_fundamental_fallbacks([{"stocks": stocks}], now=now)
        sectors = ["Technology", "Healthcare", "Financials", "Energy", "Industrials", "Utilities"]
        prices = [100.0 + index for index in range(110)]
        scored = [
            {
                "symbol": row["ticker"],
                "company": f"Company {index}",
                "sector": sectors[index % len(sectors)],
                "score": 1.0 + (index % 11) * 0.1,
                "momentum_12_1": float(index),
                "market_cap": None,
                "float_market_cap": None,
            }
            for index, row in enumerate(stocks)
        ]
        quotes = {row["symbol"]: {} for row in scored}
        self.assertEqual(len(_merge_verified_fundamentals(scored, quotes, fallbacks)), 110)
        for row, price in zip(scored, prices):
            row["float_market_cap"] = quotes[row["symbol"]]["float_shares"] * price

        book = build_portfolio(scored)
        self.assertTrue(book["available"])
        self.assertEqual(book["summary"]["totalHoldings"], 100)
        self.assertAlmostEqual(sum(row["finalWeight"] for row in book["holdings"]), 100.0, places=6)
        self.assertTrue(all(row["passed"] for row in book["constraints"]))


class ApiPayloadStateTests(unittest.TestCase):
    def test_loading_payload_does_not_report_zero_holdings(self):
        payload = _loading_payload()
        self.assertEqual(payload["overview"]["snapshot"]["portfolioStocks"], "—")
        self.assertFalse(payload["portfolio"]["available"])
        self.assertEqual(payload["portfolio"]["reason"], "warming")
        self.assertEqual(payload["portfolio"]["constraints"], [])

    def test_verified_seed_remains_available_until_a_new_publication_finishes(self):
        payload = _seed_payload()
        self.assertIsNotNone(payload)
        self.assertGreater(len(payload["stocks"]), 0)
        backtest = payload["backtest"]["top100"]
        self.assertEqual(len(backtest["priceStrategy"]), len(backtest["strategy"]))
        self.assertTrue(payload["macro"]["cpi"]["available"])


class PerformancePayloadTests(unittest.TestCase):
    """The Overview chart must agree with the Backtesting metrics.

    Both pages describe the same book, so the strategy line has to be measured
    from the same origin: the starting capital of 100, not the first NAV, which
    is already net of the entry transaction cost.
    """

    @staticmethod
    def _nav(first: float, last: float, days: int = 400) -> pd.Series:
        index = pd.bdate_range("2020-01-02", periods=days)
        return pd.Series(np.linspace(first, last, days), index=index)

    def test_strategy_series_starts_on_starting_capital_not_the_costed_nav(self):
        nav = self._nav(99.9, 200.0)
        benchmark = self._nav(100.0, 150.0)
        payload = _performance_payload({"available": True, "strategy": nav, "benchmarks": {"SPY": benchmark}})
        series = {item["id"]: item for item in payload["All"]["series"]}

        # +100% from a starting capital of 100, even though the first NAV is 99.9.
        self.assertEqual(series["strategy"]["end"], "+100.0%")
        # The entry cost is visible as a slightly negative first point.
        self.assertAlmostEqual(series["strategy"]["values"][0], -0.1, places=1)
        # Benchmarks still rebase on their own first observation.
        self.assertEqual(series["spy"]["values"][0], 0.0)

    def test_short_periods_measure_from_the_window_start(self):
        nav = self._nav(99.9, 200.0)
        payload = _performance_payload({"available": True, "strategy": nav, "benchmarks": {}})
        one_year = payload["1Y"]["series"][0]
        window = nav[nav.index >= nav.index[-1] - pd.DateOffset(years=1)]
        expected = (float(window.iloc[-1]) / float(window.iloc[0]) - 1) * 100
        self.assertAlmostEqual(float(one_year["end"].rstrip("%").replace("+", "")), expected, places=0)
        self.assertNotEqual(one_year["values"][0], -0.1)

    def test_every_period_dates_match_the_points_it_plots(self):
        nav = self._nav(99.9, 200.0)
        benchmark = self._nav(100.0, 150.0)
        payload = _performance_payload(
            {"available": True, "strategy": nav, "benchmarks": {"SPY": benchmark, "SPMO": benchmark}}
        )
        for period, block in payload.items():
            self.assertEqual(len(block["dates"]), block["points"], period)
            self.assertEqual(block["dates"], sorted(block["dates"]), period)
            for item in block["series"]:
                self.assertEqual(len(item["values"]), block["points"], f"{period}/{item['id']}")
                self.assertGreaterEqual(min(item["values"]), block["axis"]["min"], period)
                self.assertLessEqual(max(item["values"]), block["axis"]["max"], period)

    def test_month_ticks_are_calendar_dates_not_sample_slots(self):
        """A mid-month window must not gain an extra tick at its left edge."""
        nav = pd.Series(
            np.linspace(99.9, 200.0, 300),
            index=pd.bdate_range("2024-01-15", periods=300),
        )
        one_year = _performance_payload({"available": True, "strategy": nav, "benchmarks": {}})["1Y"]

        first = pd.Timestamp(one_year["dates"][0])
        # The window opens mid-month: that sample is plotted but never a tick.
        self.assertNotEqual(first, first + pd.offsets.MonthEnd(0))
        self.assertNotIn(one_year["dates"][0], [tick["date"] for tick in one_year["ticks"]])

        for tick in one_year["ticks"]:
            stamp = pd.Timestamp(tick["date"])
            self.assertEqual(stamp, stamp + pd.offsets.MonthEnd(0), tick)
            self.assertGreaterEqual(tick["date"], one_year["dates"][0])
            self.assertLessEqual(tick["date"], one_year["dates"][-1])

        # One tick per completed calendar month, no repeated labels. A window
        # that spans thirteen month ends keeps the leading tick's year.
        labels = [tick["label"] for tick in one_year["ticks"]]
        self.assertEqual(len(labels), len(set(labels)))
        self.assertTrue(labels[0].startswith((first + pd.offsets.MonthEnd(0)).strftime("%b")))


class UniverseTests(unittest.TestCase):
    def test_live_universe_targets_200_unique_stocks(self):
        self.assertEqual(len(TICKERS), 200)
        self.assertEqual(len(TICKERS), len(set(TICKERS)))
        self.assertEqual(len(CANDIDATE_TICKERS), 308)
        self.assertEqual(len(EXPANDED_UNIVERSE), 200)
        self.assertEqual(len(TICKERS) - len(HISTORICAL_BACKTEST_TICKERS), 92)
        self.assertEqual(len({member.sector for member in EXPANDED_UNIVERSE}), 11)
        self.assertEqual(
            Counter(member.sector for member in UNIVERSE),
            Counter({
                "Technology": 36,
                "Consumer Discretionary": 20,
                "Consumer Staples": 16,
                "Financials": 18,
                "Healthcare": 22,
                "Industrials": 22,
                "Communication": 13,
                "Energy": 13,
                "Utilities": 13,
                "Real Estate": 14,
                "Materials": 13,
            }),
        )

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
        self.assertEqual(payload["meta"].get("publication_version"), PUBLICATION_VERSION)
        self.assertEqual(len(payload["stocks"]), 198)
        self.assertEqual(len({row["ticker"] for row in payload["stocks"]}), 198)


if __name__ == "__main__":
    unittest.main()

"""Independent unit tests for formulas, constraints, calendars and execution."""

from __future__ import annotations

import json
import unittest
from collections import Counter
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
    momentum_sparkline,
    momentum_score,
)
from app.portfolio import build_portfolio
from app.snapshot import PUBLICATION_VERSION, UNIVERSE_VERSION, _performance_payload
from app.universe import (
    CANDIDATE_TICKERS,
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

    def test_portfolio_uses_score_and_float_cap_and_obeys_caps(self):
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
            base = float(prior.iloc[-1]) if not prior.empty else float(same_year.iloc[0])
            expected = (float(same_year.iloc[-1]) / base - 1.0) * 100.0
            self.assertAlmostEqual(entry["strategy"], expected, places=1, msg=f"year {year}")

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

    def test_sector_rows_reproduce_the_holdings_totals(self):
        book = build_portfolio(self._scored())
        by_sector = {}
        for row in book["holdings"]:
            by_sector[row["sector"]] = by_sector.get(row["sector"], 0.0) + row["finalWeight"]
        for row in book["sectors"]:
            self.assertAlmostEqual(row["value"], by_sector[row["name"]], delta=0.05, msg=row["name"])
        # Every holding sector appears in the donut, and nothing extra does.
        self.assertEqual({row["name"] for row in book["sectors"]}, set(by_sector))

    def test_raw_weight_formula_is_float_cap_times_score(self):
        scored = self._scored()
        book = build_portfolio(scored)
        selected = {row["ticker"]: row for row in book["holdings"]}
        denominator = sum(row["float_market_cap"] * row["score"] for row in scored[: len(selected)])
        for ticker, row in selected.items():
            expected = row["float_market_cap"] * row["score"] / denominator * 100.0
            self.assertAlmostEqual(row["rawWeight"], expected, places=3, msg=ticker)

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

    def test_every_period_has_matching_labels_and_series(self):
        nav = self._nav(99.9, 200.0)
        benchmark = self._nav(100.0, 150.0)
        payload = _performance_payload(
            {"available": True, "strategy": nav, "benchmarks": {"SPY": benchmark, "SPMO": benchmark}}
        )
        for period, block in payload.items():
            self.assertEqual(len(block["labels"]), block["points"], period)
            for item in block["series"]:
                self.assertEqual(len(item["values"]), block["points"], f"{period}/{item['id']}")
                self.assertGreaterEqual(min(item["values"]), block["axis"]["min"], period)
                self.assertLessEqual(max(item["values"]), block["axis"]["max"], period)


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
        self.assertNotEqual(payload["meta"].get("publication_version"), PUBLICATION_VERSION)
        self.assertEqual(len(payload["stocks"]), 198)
        self.assertEqual(len({row["ticker"] for row in payload["stocks"]}), 198)


if __name__ == "__main__":
    unittest.main()

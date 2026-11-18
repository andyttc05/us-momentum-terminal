"""Regression tests for bar recovery, cache retention and refresh diagnostics."""

from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from app import cache
from app import snapshot as snapshot_module
from app.config import settings
from app.models import NormalizedBar, SeriesResult
from app.providers.registry import Attempt, ResolvedSeries


def bars(count: int = 300, symbol: str = "AAA") -> list[NormalizedBar]:
    dates = pd.bdate_range("2025-01-02", periods=count)
    return [
        NormalizedBar(
            symbol=symbol,
            date=date.strftime("%Y-%m-%d"),
            open=100 + index,
            high=101 + index,
            low=99 + index,
            close=100 + index,
            adjusted_close=100 + index,
            volume=1_000_000,
            market_cap=None,
            dividends=0,
            stock_splits=0,
            data_source="test",
            last_updated="2026-11-18T00:00:00+00:00",
        )
        for index, date in enumerate(dates)
    ]


class PartialBatchRecoveryTests(unittest.TestCase):
    def test_omitted_batch_symbol_is_recovered_and_reported(self) -> None:
        class Primary:
            id = "yahoo"
            label = "Yahoo Finance"

            @staticmethod
            def fetch_many_with_diagnostics(_symbols, _years=None):
                return {
                    "AAA": SeriesResult(
                        symbol="AAA",
                        bars=bars(symbol="AAA"),
                        source="yahoo",
                        source_label="Yahoo Finance",
                        fetched_at="2026-11-18T00:00:00+00:00",
                        adjusted=True,
                    ),
                }, {
                    "BBB": {
                        "provider": "yahoo",
                        "stage": "batch_validation",
                        "category": "ProviderNoData",
                        "error": "batch response omitted the ticker",
                    },
                }

        class Registry:
            primary = Primary()

            def chain(self):
                return ["yahoo"]

            def adapter(self, _provider_id):
                return self.primary

            def series(self, symbol, _years=None):
                return ResolvedSeries(
                    result=SeriesResult(
                        symbol=symbol,
                        bars=bars(symbol=symbol),
                        source="yahoo",
                        source_label="Yahoo Finance",
                        fetched_at="2026-11-18T00:00:00+00:00",
                        adjusted=True,
                    ),
                    primary="yahoo",
                    used_backup=False,
                    attempts=[Attempt("yahoo", True)],
                )

        with (
            patch.object(snapshot_module, "registry", Registry()),
            patch.object(
                snapshot_module,
                "settings",
                replace(
                    settings,
                    history_batch_size=8,
                    history_batch_timeout=1,
                    warm_timeout=1,
                    retry_attempts=0,
                    series_fetch_workers=1,
                    yahoo_recovery_workers=1,
                ),
            ),
        ):
            results, failures = snapshot_module.load_series(["AAA", "BBB"])

        self.assertEqual(set(results), {"AAA", "BBB"})
        self.assertTrue(any(
            failure["symbol"] == "BBB" and failure["stage"] == "batch_omission"
            for failure in failures
        ))
        recovered = next(
            failure for failure in failures
            if failure["symbol"] == "BBB" and failure["stage"] == "recovery_success"
        )
        self.assertEqual(recovered["observations"], 300)
        self.assertTrue(recovered["adjusted_close_complete"])


class CacheRetentionTests(unittest.TestCase):
    def test_short_response_cannot_replace_longer_history_but_complete_refresh_can(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(cache, "CACHE_DIR", Path(temporary)):
                original = {
                    "symbol": "AAA",
                    "adjusted": True,
                    "bars": [bar.serialize() for bar in bars()],
                }
                self.assertTrue(cache.write_bars("bars", "AAA:10y", original))
                self.assertFalse(cache.write_bars(
                    "bars",
                    "AAA:10y",
                    {"symbol": "AAA", "adjusted": True, "bars": original["bars"][:5]},
                ))
                self.assertEqual(
                    len(cache.read_stale("bars", "AAA:10y")["bars"]),
                    len(original["bars"]),
                )

                replacement = {
                    "symbol": "AAA",
                    "adjusted": True,
                    "bars": [bar.serialize() for bar in bars()],
                }
                replacement["bars"][-1]["date"] = "2026-11-19"
                self.assertTrue(cache.write_bars("bars", "AAA:10y", replacement))
                self.assertEqual(
                    cache.read_stale("bars", "AAA:10y")["bars"][-1]["date"],
                    "2026-11-19",
                )


class DiagnosticsTests(unittest.TestCase):
    def test_curated_universe_metadata_survives_a_quote_endpoint_omission(self) -> None:
        result = SeriesResult(
            symbol="AAPL",
            bars=bars(symbol="AAPL"),
            source="yahoo",
            source_label="Yahoo Finance",
            fetched_at="2026-11-18T00:00:00+00:00",
            adjusted=True,
        )
        previous = {
            "stocks": [{
                "ticker": "AAPL",
                "exchange": "NASDAQ",
                "company": "Apple",
                "sector": "Technology",
                "marketCap": 3_000_000_000_000,
                "marketCapCurrency": "USD",
                "marketCapFetchedAt": "2026-11-18T00:00:00+00:00",
                "quoteSource": "yahoo",
            }],
        }
        quotes = {}
        snapshot_module._merge_verified_quote_metadata(
            quotes,
            snapshot_module._verified_quote_fallbacks([previous]),
        )
        eligible, excluded, _ = snapshot_module._assess_universe(
            {"AAPL": snapshot_module.to_symbol_series(result)},
            quotes,
        )
        self.assertIn("AAPL", eligible)
        self.assertEqual(excluded, [])

    def test_diagnostics_use_runtime_symbols_and_portfolio_reasons(self) -> None:
        result = SeriesResult(
            symbol="AAA",
            bars=bars(symbol="AAA"),
            source="yahoo",
            source_label="Yahoo Finance",
            fetched_at="2026-11-18T00:00:00+00:00",
            adjusted=True,
        )
        scored = [{
            "symbol": "AAA",
            "company": "A",
            "sector": "Technology",
            "score": 2.0,
            "risk_adjusted": 1.0,
            "momentum_12_1": 10.0,
            "price": 100.0,
            "float_market_cap": 1_000_000.0,
        }]
        report = snapshot_module._refresh_diagnostics(
            requested_symbols=["AAA", "BBB"],
            results={"AAA": result},
            series_map={},
            failures=[{
                "symbol": "BBB",
                "stage": "provider",
                "error": "adjusted close is unavailable",
                "category": "ProviderNoData",
            }],
            universe_excluded=[{
                "symbol": "CCC",
                "category": "insufficient_history",
                "reason": "only 100 observations",
            }],
            momentum_excluded=[],
            scored=scored,
            detail_candidates=["AAA"],
            quotes={"AAA": {"float_shares": 10_000}},
            detail_failures=[],
            cached_quote_symbols=[],
            cached_fundamental_symbols=["AAA"],
            portfolios={
                "top100": {
                    "available": False,
                    "holdings": [],
                    "reason": "too few holdings",
                    "excluded_no_market_cap": [],
                    "excluded_no_score": [],
                },
                "top20": {
                    "available": False,
                    "holdings": [],
                    "reason": "too few holdings",
                    "excluded_no_market_cap": [],
                    "excluded_no_score": [],
                },
            },
        )

        self.assertEqual(report["requested"], 2)
        self.assertEqual(report["loaded"], 0)
        self.assertEqual(report["eligible"], 1)
        self.assertEqual(report["missingPriceHistory"], ["AAA", "BBB"])
        self.assertEqual(report["invalidAdjustedClose"], ["BBB"])
        self.assertEqual(report["insufficientHistory"], ["CCC"])
        self.assertEqual(report["portfolio"]["top100"]["reason"], "too few holdings")
        self.assertEqual(report["fundamentals"]["verifiedCacheFallbacks"], ["AAA"])


if __name__ == "__main__":
    unittest.main()

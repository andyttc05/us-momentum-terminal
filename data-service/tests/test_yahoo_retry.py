"""Yahoo retries must recover transient failures without inventing tickers."""

from __future__ import annotations

import unittest
from dataclasses import replace
from unittest.mock import patch

import pandas as pd

from app.config import settings
from app.models import ProviderRateLimited, ProviderUnavailable
from app.providers.yahoo import YahooProvider


class FakeYahoo:
    def __init__(self) -> None:
        self.calls = 0

    def download(self, symbols, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("HTTP 429")
        index = pd.date_range("2026-01-02", periods=2, freq="B")
        # Deliberately omit BBB: it must be handed to load_series' individual
        # recovery path, not appear as an empty/synthetic Yahoo result.
        columns = pd.MultiIndex.from_product([["AAA"], ["Open", "High", "Low", "Close", "Adj Close", "Volume", "Dividends", "Stock Splits"]])
        return pd.DataFrame([[10, 11, 9, 10, 10, 100, 0, 0], [11, 12, 10, 11, 11, 120, 0, 0]], index=index, columns=columns)


class YahooRetryTests(unittest.TestCase):
    def test_small_batch_retries_and_reports_only_validated_symbols(self) -> None:
        fake = FakeYahoo()
        tuned = replace(
            settings,
            yahoo_retry_attempts=1,
            yahoo_retry_base_seconds=0,
            yahoo_batch_size=8,
            yahoo_min_bars=1,
        )
        with (
            patch("app.providers.yahoo._import_yfinance", return_value=fake),
            patch("app.providers.yahoo.settings", tuned),
            patch("app.providers.yahoo.cache.read", return_value=None),
            patch("app.providers.yahoo.cache.write_bars"),
        ):
            results = YahooProvider().fetch_many(["AAA", "BBB"], years=1)

        self.assertEqual(fake.calls, 2)
        self.assertEqual(set(results), {"AAA"})
        self.assertEqual(results["AAA"].bars[-1].date, "2026-01-05")

    def test_truncated_or_unadjusted_batch_series_are_not_reported_as_loaded(self) -> None:
        class TruncatedYahoo:
            def download(self, symbols, **_kwargs):
                index = pd.date_range("2026-11-10", periods=3, freq="B")
                columns = pd.MultiIndex.from_product(
                    [symbols, ["Open", "High", "Low", "Close", "Adj Close", "Volume", "Dividends", "Stock Splits"]]
                )
                rows = []
                for symbol in symbols:
                    for row_number in range(3):
                        rows.append([
                            10 + row_number,
                            11 + row_number,
                            9 + row_number,
                            10 + row_number,
                            10 + row_number if symbol == "AAA" else None,
                            100,
                            0,
                            0,
                        ])
                return pd.DataFrame(rows, index=index.repeat(len(symbols)), columns=columns)

        tuned = replace(
            settings,
            yahoo_retry_attempts=0,
            yahoo_batch_size=8,
            yahoo_min_bars=210,
        )
        with (
            patch("app.providers.yahoo._import_yfinance", return_value=TruncatedYahoo()),
            patch("app.providers.yahoo.settings", tuned),
            patch("app.providers.yahoo.cache.read", return_value=None),
            patch("app.providers.yahoo.cache.write_bars") as write,
            patch("app.providers.yahoo._LIMITER"),
        ):
            results = YahooProvider().fetch_many(["AAA", "BBB"], years=1)

        self.assertEqual(results, {})
        write.assert_not_called()

    def test_batch_retries_use_bounded_exponential_backoff(self) -> None:
        class FailingYahoo:
            def download(self, *_args, **_kwargs):
                raise RuntimeError("HTTP 429")

        provider = YahooProvider()
        tuned = replace(
            settings,
            yahoo_retry_attempts=2,
            yahoo_retry_base_seconds=1.25,
            yahoo_batch_size=8,
        )
        delays = []
        with (
            patch("app.providers.yahoo.settings", tuned),
            patch("app.providers.yahoo._LIMITER"),
            patch("app.providers.yahoo._BATCH_LOCK"),
            patch("app.providers.yahoo.random.uniform", return_value=0),
            patch("app.providers.yahoo.time.sleep", side_effect=delays.append),
        ):
            with self.assertRaises(ProviderUnavailable):
                provider._download(FailingYahoo(), ["AAA", "BBB"], years=1)

        self.assertEqual(delays, [1.25, 2.5])

    def test_rate_limited_single_symbol_is_retried_then_classified(self) -> None:
        class RateLimitedTicker:
            def __init__(self, _symbol):
                self.calls = 0

            def history(self, **_kwargs):
                self.calls += 1
                raise RuntimeError("HTTP 429 Too Many Requests")

        ticker = RateLimitedTicker("AAA")
        class FakeClient:
            def Ticker(self, _symbol):
                return ticker

        tuned = replace(settings, yahoo_retry_attempts=2, yahoo_retry_base_seconds=0)
        with (
            patch("app.providers.yahoo._import_yfinance", return_value=FakeClient()),
            patch("app.providers.yahoo.settings", tuned),
            patch("app.providers.yahoo.cache.read", return_value=None),
            patch("app.providers.yahoo.cache.read_stale", return_value=None),
            patch("app.providers.yahoo._LIMITER"),
            patch("app.providers.yahoo.time.sleep"),
        ):
            with self.assertRaises(ProviderRateLimited):
                YahooProvider().fetch_series("AAA", years=1)

        self.assertEqual(ticker.calls, 3)

    def test_incomplete_stale_cache_cannot_stand_in_for_a_failed_series(self) -> None:
        class EmptyTicker:
            def history(self, **_kwargs):
                return pd.DataFrame()

        class FakeClient:
            def Ticker(self, _symbol):
                return EmptyTicker()

        tuned = replace(
            settings,
            yahoo_retry_attempts=0,
            yahoo_retry_base_seconds=0,
            yahoo_min_bars=210,
        )
        short_cache = {
            "symbol": "BKH",
            "fetched_at": "2026-11-18T00:00:00+00:00",
            "adjusted": True,
            "bars": [{"symbol": "BKH"}],
        }
        with (
            patch("app.providers.yahoo._import_yfinance", return_value=FakeClient()),
            patch("app.providers.yahoo.settings", tuned),
            patch("app.providers.yahoo.cache.read", return_value=None),
            patch("app.providers.yahoo.cache.read_stale", return_value=short_cache),
            patch("app.providers.yahoo._LIMITER"),
        ):
            with self.assertRaisesRegex(Exception, "incomplete history"):
                YahooProvider().fetch_series("BKH", years=1)

    def test_incomplete_float_metadata_is_retried_and_never_written_partial(self) -> None:
        class DetailedTicker:
            def __init__(self) -> None:
                self.calls = 0

            @property
            def info(self):
                self.calls += 1
                if self.calls == 1:
                    return {"quoteType": "EQUITY", "sector": "Technology"}
                return {
                    "quoteType": "EQUITY",
                    "sector": "Technology",
                    "shortName": "AAA Corp",
                    "exchange": "NYSE",
                    "currency": "USD",
                    "marketCap": 1_000_000,
                    "sharesOutstanding": 100_000,
                    "floatShares": 80_000,
                    "averageVolume": 10_000,
                    "regularMarketPrice": 10,
                }

        ticker = DetailedTicker()
        class FakeClient:
            def Ticker(self, _symbol):
                return ticker

        tuned = replace(settings, yahoo_retry_attempts=2, yahoo_retry_base_seconds=0)
        with (
            patch("app.providers.yahoo._import_yfinance", return_value=FakeClient()),
            patch("app.providers.yahoo.settings", tuned),
            patch("app.providers.yahoo.cache.read", return_value=None),
            patch("app.providers.yahoo.cache.read_stale", return_value=None),
            patch("app.providers.yahoo.cache.write") as write,
            patch("app.providers.yahoo._LIMITER"),
            patch("app.providers.yahoo.time.sleep"),
        ):
            quote = YahooProvider().fetch_detailed_quote("AAA")

        self.assertEqual(ticker.calls, 2)
        self.assertEqual(quote.float_shares, 80_000)
        write.assert_called_once()
        self.assertEqual(write.call_args.args[2]["float_shares"], 80_000)


if __name__ == "__main__":
    unittest.main()

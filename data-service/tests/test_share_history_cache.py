"""Share-history caching rules for the historical sizing input.

The point of these tests is that a faster cache must never change which share
counts the engine sees: the same observations, the same fallback to a stale
disclosure, and the same report when a symbol has nothing at all.
"""

from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import size_history  # noqa: E402


POINTS = [["2020-01-02", 100], ["2021-01-04", 200], ["2022-01-03", 300]]


class ShareHistoryRecheckTests(unittest.TestCase):
    def setUp(self):
        self.store = {}
        self.fetch_calls = []

        def read_stale(namespace, key):
            value = self.store.get((namespace, key))
            return dict(value) if value else None

        def write(namespace, key, value):
            self.store[(namespace, key)] = dict(value)

        patches = [
            mock.patch.object(size_history.cache, "read_stale", side_effect=read_stale),
            mock.patch.object(size_history.cache, "write", side_effect=write),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def _seed(self, symbol, points, checked_at=None):
        payload = {"symbol": symbol, "source": size_history.SHARE_SOURCE, "points": points}
        if checked_at is not None:
            payload["checked_at"] = checked_at
        self.store[(size_history.SHARE_NAMESPACE, symbol)] = payload

    def _mock_provider(self, points):
        def fake(symbol, start, end):
            self.fetch_calls.append(symbol)
            return points
        return mock.patch.object(size_history.yahoo, "share_history", side_effect=fake)

    def test_a_fresh_series_is_never_refetched(self):
        self._seed("AAA", POINTS)
        with self._mock_provider(POINTS):
            # 43 days after the newest observation: inside SHARE_REFRESH_DAYS.
            resolved, fetched = size_history._ensure_one("AAA", "2022-02-15")
        self.assertEqual((resolved, fetched), (True, False))
        self.assertEqual(self.fetch_calls, [])

    def test_a_successful_fetch_is_stamped_so_the_next_run_skips_it(self):
        # The series ends in 2022, so it stays "stale" for a 2024 signal date.
        self._seed("FB", POINTS)
        with self._mock_provider(POINTS):
            first = size_history._ensure_one("FB", "2024-11-29")
            second = size_history._ensure_one("FB", "2024-11-29")

        self.assertEqual(first, (True, True))   # fetched once
        self.assertEqual(second, (True, False))  # recheck window applies
        self.assertEqual(self.fetch_calls, ["FB"])
        self.assertIn("checked_at", self.store[(size_history.SHARE_NAMESPACE, "FB")])

    def test_the_recheck_window_expires(self):
        stale_stamp = time.time() - (size_history.SHARE_RECHECK_DAYS + 1) * 86_400
        self._seed("UTX", POINTS, checked_at=stale_stamp)
        with self._mock_provider(POINTS):
            resolved, fetched = size_history._ensure_one("UTX", "2024-11-29")
        self.assertEqual((resolved, fetched), (True, True))
        self.assertEqual(self.fetch_calls, ["UTX"])

    def test_a_failed_fetch_is_not_remembered(self):
        self._seed("FB", POINTS)
        with mock.patch.object(size_history.yahoo, "share_history", return_value=[]):
            first = size_history._ensure_one("FB", "2024-11-29")
            second = size_history._ensure_one("FB", "2024-11-29")
        # Both attempts retry: a provider outage must not be cached as "no data".
        self.assertEqual(first, (True, False))
        self.assertEqual(second, (True, False))
        self.assertNotIn("checked_at", self.store[(size_history.SHARE_NAMESPACE, "FB")])

    def test_a_stale_series_is_still_used_when_the_provider_is_empty(self):
        self._seed("AAA", POINTS)
        with mock.patch.object(size_history.yahoo, "share_history", return_value=[]):
            resolved, fetched = size_history._ensure_one("AAA", "2024-11-29")
        self.assertTrue(resolved, "a real disclosure must never be dropped")
        self.assertFalse(fetched)

    def test_a_symbol_with_nothing_is_reported_missing(self):
        with mock.patch.object(size_history.yahoo, "share_history", return_value=[]):
            resolved, fetched = size_history._ensure_one("ZZZ", "2024-11-29")
        self.assertEqual((resolved, fetched), (False, False))

    def test_the_universe_report_is_unchanged_by_the_cache(self):
        self._seed("AAA", POINTS, checked_at=time.time())
        self._seed("FB", POINTS, checked_at=time.time())
        with mock.patch.object(size_history.yahoo, "share_history", return_value=[]):
            report = size_history.ensure_share_history(["AAA", "FB", "ZZZ"], end="2024-11-29")
        self.assertEqual(report["requested"], 3)
        self.assertEqual(report["resolved"], 2)
        self.assertEqual(report["fetched"], 0)
        self.assertEqual(report["missing"], ["ZZZ"])

    def test_prices_still_pair_with_the_share_count_in_effect(self):
        """The sizing input itself must not change: date x split-adjusted close."""
        self._seed("AAA", POINTS, checked_at=time.time())
        import pandas as pd

        frame = pd.DataFrame(
            {"close": [10.0, 20.0, 30.0], "splits": [0.0, 0.0, 0.0]},
            index=pd.to_datetime(["2020-01-02", "2021-01-04", "2022-01-03"]),
        )
        series = mock.Mock()
        series.frame = frame
        lookup = size_history.market_cap_lookup({"AAA": series})
        self.assertEqual(lookup("AAA", "2022-01-03"), 30.0 * 300)
        self.assertEqual(lookup("AAA", "2021-06-01"), 20.0 * 200)


if __name__ == "__main__":
    unittest.main()

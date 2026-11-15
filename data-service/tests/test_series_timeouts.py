"""A provider that never answers must not take the warm-up down with it.

The hosted service used to stall at "163 of 203 bars loaded" and never publish
again: one batch call hung, `as_completed` waited on it forever, closing the
executor waited on it again, and `_WARMING["active"]` therefore stayed true — so
no new warm-up could start and every request answered slowly. These tests pin
the bounded wait that replaced it.
"""

from __future__ import annotations

import time
import unittest
from dataclasses import replace

from app import snapshot as snapshot_module
from app.config import settings


class HangingAdapter:
    """A provider whose batch call never returns within the budget."""

    id = "yahoo"
    label = "Hanging"

    def __init__(self, delay: float = 2.0) -> None:
        self.delay = delay

    def fetch_many(self, symbols, years=None):
        time.sleep(self.delay)
        return {}


class StubRegistry:
    def __init__(self, adapter) -> None:
        self._adapter = adapter

    def chain(self):
        return ["yahoo"]

    def adapter(self, _provider_id):
        return self._adapter

    def series(self, _symbol, _years):
        raise RuntimeError("provider unreachable")


class LoadSeriesTimeoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_registry = snapshot_module.registry
        self.original_settings = snapshot_module.settings
        snapshot_module.registry = StubRegistry(HangingAdapter())
        snapshot_module.settings = replace(
            settings,
            history_batch_size=2,
            history_batch_timeout=0.1,
            warm_timeout=0.2,
            retry_attempts=0,
        )

    def tearDown(self) -> None:
        snapshot_module.registry = self.original_registry
        snapshot_module.settings = self.original_settings

    def test_a_hanging_batch_costs_the_batch_not_the_warm_up(self) -> None:
        started = time.monotonic()
        results, failures = snapshot_module.load_series(["AAA", "BBB", "CCC"])
        elapsed = time.monotonic() - started

        self.assertLess(elapsed, 1.5, "the warm-up waited on a hung provider call")
        self.assertEqual(results, {})
        self.assertTrue(
            any(failure["stage"] == "batch" for failure in failures),
            f"the abandoned batch was not recorded: {failures}",
        )
        self.assertTrue(
            any(failure["stage"] in {"unexpected", "provider", "symbol"} for failure in failures),
            f"the per-symbol retry never ran: {failures}",
        )


if __name__ == "__main__":
    unittest.main()

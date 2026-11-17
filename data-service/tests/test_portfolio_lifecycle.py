import unittest

import pandas as pd

from app.momentum import SymbolSeries
from app.snapshot import _portfolio_lifecycle


def book(universe, count, weight):
    holdings = [{"ticker": f"{universe}{index}", "rank": index + 1, "finalWeight": weight} for index in range(count)]
    return {
        "available": True,
        "holdings": holdings,
        "constraints": [{"id": rule, "passed": True} for rule in ("max-stock", "max-sector", "target-holdings", "target-allocation")],
        "validation": {"evaluated": True},
        "summary": {"totalHoldings": count},
    }


def series(dates):
    index = pd.to_datetime(dates)
    frame = pd.DataFrame({"adj": [100.0] * len(index), "close": [100.0] * len(index), "volume": [1.0] * len(index)}, index=index)
    return {"AAA": SymbolSeries("AAA", frame, "test", "test", "", True, False)}


class PortfolioLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.candidates = {"top100": book("A", 100, 1.0), "top20": book("B", 20, 5.0)}

    def test_daily_snapshot_preserves_active_holdings_and_target_weights(self):
        old = {
            key: {"activePortfolio": book(key, count, 100 / count), "meta": {"asOf": "2026-01-02"}}
            for key, count in (("top100", 100), ("top20", 20))
        }
        old["top100"]["activePortfolio"]["holdings"][0]["ticker"] = "HELD"
        old["top100"]["activePortfolio"]["holdings"][0]["finalWeight"] = 8.25
        result = _portfolio_lifecycle(self.candidates, old, series(["2026-01-02", "2026-01-05"]), as_of="2026-01-05", generated_at="now")
        active = result["top100"]["activePortfolio"]["holdings"][0]
        self.assertEqual((active["ticker"], active["finalWeight"]), ("HELD", 8.25))
        self.assertNotEqual(result["top100"]["liveSignals"]["holdings"][0]["ticker"], "HELD")

    def test_top100_and_top20_states_remain_independent(self):
        old = {key: {"activePortfolio": book(key, count, 100 / count), "meta": {"asOf": "2026-01-02"}}
               for key, count in (("top100", 100), ("top20", 20))}
        result = _portfolio_lifecycle(self.candidates, old, series(["2026-01-02", "2026-01-05"]), as_of="2026-01-05", generated_at="now")
        self.assertEqual(len(result["top100"]["activePortfolio"]["holdings"]), 100)
        self.assertEqual(len(result["top20"]["activePortfolio"]["holdings"]), 20)

    def test_scheduled_candidate_waits_for_execution_session(self):
        active100 = book("OLD", 100, 1.0)
        active20 = book("OLD20", 20, 5.0)
        old = {
            "top100": {"activePortfolio": active100, "meta": {"asOf": "2025-09-30"}},
            "top20": {"activePortfolio": active20, "meta": {"asOf": "2025-09-30"}},
        }
        for key, value in old.items():
            value["activePortfolio"]["metadata"] = {"effectiveDate": "2025-09-30", "signalDate": "2025-09-30"}
        pending = _portfolio_lifecycle(self.candidates, old, series(["2026-03-30", "2026-03-31"]), as_of="2026-03-31", generated_at="signal")
        self.assertEqual(pending["top100"]["activePortfolio"]["holdings"][0]["ticker"], "OLD0")
        self.assertIsNone(pending["top100"]["pendingRebalance"]["executionDate"])

        later = _portfolio_lifecycle(self.candidates, pending, series(["2026-03-30", "2026-03-31", "2026-04-01"]), as_of="2026-04-01", generated_at="execution")
        self.assertEqual(later["top100"]["activePortfolio"]["holdings"][0]["ticker"], "A0")
        self.assertEqual(later["top100"]["activePortfolio"]["metadata"]["effectiveDate"], "2026-04-01")
        self.assertIsNone(later["top100"]["pendingRebalance"])

    def test_invalid_candidate_does_not_replace_previous_book(self):
        old = {key: {"activePortfolio": book(key, count, 100 / count)} for key, count in (("top100", 100), ("top20", 20))}
        self.candidates["top100"]["constraints"][0]["passed"] = False
        result = _portfolio_lifecycle(self.candidates, old, series(["2026-01-02", "2026-01-05"]), as_of="2026-01-05", generated_at="now")
        self.assertEqual(result["top100"]["activePortfolio"]["holdings"][0]["ticker"], "top1000")


if __name__ == "__main__":
    unittest.main()

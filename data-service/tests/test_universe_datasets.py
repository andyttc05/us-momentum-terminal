"""The publication must expose one internally consistent dataset per universe."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.snapshot import build_universe_datasets  # noqa: E402


def ranked_stocks(count: int = 100) -> list[dict]:
    return [
        {
            "ticker": f"T{index:02d}",
            "rank": index + 1,
            "price": 100.0 + index,
            "score": 4.0 - index * 0.01,
            "trend": [1.0, 2.0],
            "sector": "Technology" if index % 2 else "Energy",
        }
        for index in range(count)
    ]


def portfolio(tickers: list[str], *, available: bool = True, status: str = "ready") -> dict:
    return {
        "available": available,
        "status": status,
        "holdings": [
            {"ticker": ticker, "finalWeight": round(100 / len(tickers), 6)}
            for ticker in tickers
        ],
        "sectors": [{"name": "Technology", "value": 100, "color": "#fff"}],
        "summary": {"totalHoldings": len(tickers)},
    }


def payload(portfolios: dict, *, stocks: list[dict] | None = None) -> dict:
    stocks = stocks or ranked_stocks()
    return {
        "meta": {
            "as_of": "2026-11-13",
            "generated_at": "2026-11-13T15:41:08+00:00",
        },
        "universe": {"scanned": 102},
        "stocks": stocks,
        "portfolios": portfolios,
        "backtest": {
            "top100": {"available": True},
            "top20": {"available": True},
        },
    }


class UniverseDatasetTests(unittest.TestCase):
    def test_selection_follows_the_portfolio_instead_of_the_first_n_rows(self) -> None:
        stocks = ranked_stocks()
        # The Top 20 book holds ranks 6..25: a name without verified float
        # shares pushed the selection past the first twenty rows.
        top20_tickers = [stock["ticker"] for stock in stocks[5:25]]
        datasets = build_universe_datasets(
            payload({
                "top100": portfolio([stock["ticker"] for stock in stocks]),
                "top20": portfolio(top20_tickers),
            })
        )

        self.assertEqual(datasets["top20"]["stockTickers"], top20_tickers)
        self.assertEqual(
            {row["ticker"] for row in datasets["top20"]["overview"]["topMomentum"]},
            set(top20_tickers[:5]),
        )
        self.assertEqual(datasets["top20"]["stockTickers"][0], "T05")
        self.assertEqual(datasets["top100"]["stockTickers"][0], "T00")

    def test_each_dataset_carries_its_own_universe_provenance(self) -> None:
        datasets = build_universe_datasets(payload({
            "top100": portfolio([f"T{index:02d}" for index in range(100)]),
            "top20": portfolio([f"T{index:02d}" for index in range(20)]),
        }))

        for universe, expected in (("top100", 100), ("top20", 20)):
            meta = datasets[universe]["meta"]
            self.assertEqual(meta["universe"], universe)
            self.assertEqual(meta["targetHoldings"], expected)
            self.assertEqual(meta["calculationDate"], "2026-11-13")
            self.assertEqual(meta["dataTimestamp"], "2026-11-13T15:41:08+00:00")
            self.assertTrue(meta["runId"].startswith(f"{universe}@2026-11-13#"))
            self.assertEqual(meta["status"], "success")
            self.assertEqual(datasets[universe]["universe"], universe)

    def test_infeasible_portfolio_never_reports_success(self) -> None:
        datasets = build_universe_datasets(payload({
            "top100": portfolio([f"T{index:02d}" for index in range(100)]),
            "top20": portfolio([], available=False, status="infeasible"),
        }))

        meta = datasets["top20"]["meta"]
        self.assertEqual(meta["status"], "unavailable")
        self.assertEqual(meta["portfolioStatus"], "infeasible")
        self.assertEqual(datasets["top20"]["overview"]["snapshot"]["portfolioStocks"], "—")

    def test_overview_snapshot_counts_the_dataset_portfolio(self) -> None:
        datasets = build_universe_datasets(payload({
            "top100": portfolio([f"T{index:02d}" for index in range(100)]),
            "top20": portfolio([f"T{index:02d}" for index in range(20)]),
        }))

        self.assertEqual(datasets["top100"]["overview"]["snapshot"]["portfolioStocks"], "100")
        self.assertEqual(datasets["top20"]["overview"]["snapshot"]["portfolioStocks"], "20")
        self.assertEqual(datasets["top20"]["overview"]["snapshot"]["eligibleStocks"], "100")
        self.assertEqual(datasets["top20"]["overview"]["snapshot"]["scannedStocks"], "102")

    def test_performance_is_scoped_to_the_dataset_backtest(self) -> None:
        performance = {
            "top100": {"All": {"series": [{"id": "strategy"}]}},
            "top20": {"All": {"series": [{"id": "strategy"}, {"id": "spy"}]}},
        }
        datasets = build_universe_datasets(
            payload({
                "top100": portfolio([f"T{index:02d}" for index in range(100)]),
                "top20": portfolio([f"T{index:02d}" for index in range(20)]),
            }),
            performances=performance,
        )

        self.assertIs(datasets["top20"]["overview"]["performance"], performance["top20"])
        self.assertIs(datasets["top100"]["overview"]["performance"], performance["top100"])


if __name__ == "__main__":
    unittest.main()

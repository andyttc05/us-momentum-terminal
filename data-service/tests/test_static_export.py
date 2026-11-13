"""Unit tests for the GitHub Pages snapshot exporter contract."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data-service" / "scripts"))

import export_static  # noqa: E402


def valid_publication(as_of: str | None = None) -> dict:
    date = as_of or datetime.now(timezone.utc).date().isoformat()
    backtest = {"available": True, "dates": ["2025-01-02"], "strategy": [100]}
    def portfolio(count: int) -> dict:
        return {
            "available": True,
            "holdings": [
                {"ticker": f"T{index}", "finalWeight": 100 / count}
                for index in range(count)
            ],
            "constraints": [
                {"id": "target-holdings", "rule": f"= {count}"},
            ],
        }

    def dataset(universe: str, count: int) -> dict:
        tickers = [f"T{index}" for index in range(count)]
        rows = [
            {"ticker": ticker, "rank": index + 1, "price": 100.0, "score": 1.0, "trend": []}
            for index, ticker in enumerate(tickers)
        ]
        return {
            "universe": universe,
            "meta": {
                "universe": universe,
                "targetHoldings": count,
                "selectedCount": count,
                "status": "success",
            },
            "stockTickers": tickers,
            "portfolio": portfolio(count),
            "overview": {
                "snapshot": {},
                "topMomentum": rows[:5],
                "sectorAllocation": [],
                "performance": {"series": []},
            },
        }

    return {
        "meta": {
            "generated_at": f"{date}T22:30:00+00:00",
            "as_of": date,
            "connection_status": "connected",
            "universe_version": export_static.UNIVERSE_VERSION,
            "publication_version": export_static.PUBLICATION_VERSION,
        },
        "universe": {"requested": 2},
        "stocks": [
            {"ticker": "AAA"},
            {"ticker": "BBB"},
        ],
        "portfolio": portfolio(100),
        "portfolios": {
            "top100": portfolio(100),
            "top20": portfolio(20),
        },
        "datasets": {
            "top100": dataset("top100", 100),
            "top20": dataset("top20", 20),
        },
        "backtest": {
            "top100": backtest,
            "top20": backtest,
        },
        "backtestSchedules": {
            portfolio: {
                frequency: backtest
                for frequency in ("monthly", "quarterly", "semiannual", "annual")
            }
            for portfolio in ("top100", "top20")
        },
    }


class StaticExportValidationTests(unittest.TestCase):
    def test_complete_current_snapshot_is_accepted(self) -> None:
        errors = export_static.validate_publication(
            valid_publication(),
            max_as_of_age_days=10,
            min_stock_ratio=0.95,
        )
        self.assertEqual(errors, [])

    def test_stale_or_incomplete_snapshot_is_rejected(self) -> None:
        payload = valid_publication("2020-01-02")
        payload["stocks"] = []
        payload["portfolio"]["available"] = False
        payload["portfolios"]["top20"]["available"] = False
        errors = export_static.validate_publication(
            payload,
            max_as_of_age_days=10,
            min_stock_ratio=0.95,
        )
        text = " ".join(errors)
        self.assertIn("no eligible stocks", text)
        self.assertIn("portfolio is unavailable", text)
        self.assertIn("top20 model portfolio is unavailable", text)
        self.assertIn("older than", text)

    def test_exact_top_twenty_may_report_a_constraint_infeasible_month(self) -> None:
        payload = valid_publication()
        payload["backtestSchedules"]["top20"]["monthly"] = {
            "available": False,
            "reason": "portfolio constraints infeasible on 2019-10-31: cap constraints cannot reach 100%",
        }
        errors = export_static.validate_publication(
            payload,
            max_as_of_age_days=10,
            min_stock_ratio=0.95,
        )
        self.assertEqual(errors, [])

    def test_manifest_must_match_published_stock_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            payload = valid_publication()
            (output / "stocks").mkdir()
            (output / "publication.json").write_text(json.dumps(payload))
            (output / "stocks" / "AAA.json").write_text("{}")
            (output / "manifest.json").write_text(json.dumps({
                "schemaVersion": export_static.SCHEMA_VERSION,
                "publicationVersion": export_static.PUBLICATION_VERSION,
                "stockCount": 2,
                "stockTickers": ["AAA", "BBB"],
            }))
            errors = export_static.validate_static_directory(
                output,
                max_as_of_age_days=10,
                min_stock_ratio=0.95,
            )
            self.assertIn("1 stock detail files are missing", " ".join(errors))

    def test_dataset_must_match_its_own_portfolio(self) -> None:
        payload = valid_publication()
        payload["datasets"]["top20"]["stockTickers"] = payload["datasets"]["top20"]["stockTickers"][:10]
        errors = export_static.validate_publication(
            payload,
            max_as_of_age_days=10,
            min_stock_ratio=0.95,
        )
        text = " ".join(errors)
        self.assertIn("top20 dataset lists 10 stocks, expected 20", text)
        self.assertIn("top20 dataset stocks do not match its portfolio holdings", text)

    def test_missing_dataset_is_rejected(self) -> None:
        payload = valid_publication()
        payload["datasets"].pop("top100")
        payload["datasets"]["top20"]["overview"]["performance"] = {}
        errors = export_static.validate_publication(
            payload,
            max_as_of_age_days=10,
            min_stock_ratio=0.95,
        )
        text = " ".join(errors)
        self.assertIn("top100 dataset is missing", text)
        self.assertIn("top20 dataset has no performance series", text)


if __name__ == "__main__":
    unittest.main()

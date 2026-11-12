#!/usr/bin/env python3
"""Phase 8 verification: integrity, maths, cross-provider prices, portfolio rules.

Runs against the live data service (http://127.0.0.1:8787) and writes
``data-service/docs/verification.json``.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "data-service" / "docs"
BASE = "http://127.0.0.1:8787"
SAMPLE = ["AAPL", "MSFT", "NVDA", "META", "JPM"]


def get(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=60) as response:
        return json.load(response)


def main() -> int:
    report: dict = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "checks": {}}
    snapshot = get("/api/snapshot")
    stocks = snapshot["stocks"]
    checks = report["checks"]

    # 1. Snapshot integrity -------------------------------------------------- #
    dates = [row["date"] for row in stocks]
    checks["universe"] = {
        "requested": snapshot["universe"]["requested"],
        "eligible": len(stocks),
        "unavailable": snapshot["universe"].get("unavailable", []),
        "excluded": len(snapshot["universe"].get("excluded", [])),
        "single_as_of_date": len(set(dates)) == 1,
        "as_of": snapshot["meta"]["as_of"],
        "min_observations": min(row["observations"] for row in stocks),
        "all_meet_minimum": all(
            row["observations"] >= snapshot["universe"]["min_momentum_observations"]
            for row in stocks
        ),
        "no_null_prices": all(isinstance(row["price"], (int, float)) and row["price"] > 0 for row in stocks),
        "no_nan_scores": all(not math.isnan(row["score"]) for row in stocks),
        "score_range": [min(row["score"] for row in stocks), max(row["score"] for row in stocks)],
    }

    # 2. Ranking is a strict order of the score ------------------------------ #
    mismatches = [
        (left["ticker"], right["ticker"])
        for left, right in zip(stocks, stocks[1:])
        if left["score"] < right["score"]
    ]
    checks["ranking"] = {
        "rank_start": stocks[0]["rank"],
        "rank_end": stocks[-1]["rank"],
        "strictly_ordered": not mismatches,
        "mismatches": mismatches[:5],
        "top_five": [(row["rank"], row["ticker"], row["score"]) for row in stocks[:5]],
    }

    # 3. Recompute momentum from the returned bars --------------------------- #
    recomputed = {}
    for ticker in SAMPLE:
        bars = get(f"/api/bars/{ticker}?days=800")["bars"]
        closes = [bar["adjusted_close"] if bar["adjusted_close"] is not None else bar["close"] for bar in bars]
        app = next(row for row in stocks if row["ticker"] == ticker)
        # Engine convention: the leg N sessions back is closes[-1-N].
        mom_12_1 = (closes[-22] / closes[-253] - 1) * 100
        mom_6 = (closes[-1] / closes[-127] - 1) * 100
        daily = [(closes[i] / closes[i - 1] - 1) for i in range(len(closes) - 252, len(closes))]
        mean = sum(daily) / len(daily)
        daily_std = math.sqrt(sum((value - mean) ** 2 for value in daily) / (len(daily) - 1))
        vol = daily_std * math.sqrt(252) * 100
        risk_adjusted = (closes[-22] / closes[-253] - 1) / daily_std
        expected_score = 1 + app["zScore"] if app["zScore"] > 0 else (
            1 / (1 - app["zScore"]) if app["zScore"] < 0 else 1
        )
        recomputed[ticker] = {
            "bars_endpoint_last_date": bars[-1]["date"],
            "snapshot_date": app["date"],
            "momentum_12_1_recomputed": round(mom_12_1, 2),
            "momentum_12_1_app": app["momentum"],
            "delta": round(abs(mom_12_1 - app["momentum"]), 3),
            "momentum_6m_recomputed": round(mom_6, 2),
            "momentum_6m_app": app["momentum6m"],
            "volatility_recomputed": round(vol, 1),
            "volatility_app": app["volatility"],
            "risk_adjusted_recomputed": round(risk_adjusted, 2),
            "risk_adjusted_app": app["riskAdjusted"],
            "score_from_displayed_z": round(expected_score, 4),
            "score_app": app["score"],
            "score_delta_from_displayed_z": round(abs(expected_score - app["score"]), 4),
        }
    checks["momentum_recompute"] = {
        "tickers": recomputed,
        "all_within_tolerance": all(
            item["delta"] < 1.0
            and abs(item["volatility_recomputed"] - item["volatility_app"]) < 0.2
            and abs(item["risk_adjusted_recomputed"] - item["risk_adjusted_app"]) < 0.02
            and item["score_delta_from_displayed_z"] < 0.03
            for item in recomputed.values()
        ),
    }

    # 4. Bar hygiene --------------------------------------------------------- #
    hygiene = {}
    for ticker in SAMPLE:
        payload = get(f"/api/bars/{ticker}?days=800")
        dates_list = [bar["date"] for bar in payload["bars"]]
        hygiene[ticker] = {
            "count": payload["count"],
            "sorted": dates_list == sorted(dates_list),
            "duplicates": len(dates_list) - len(set(dates_list)),
            "first": dates_list[0],
            "last": dates_list[-1],
            "adjusted": payload["adjusted"],
            "source": payload["source"],
            "warnings": payload["warnings"],
        }
    checks["bar_hygiene"] = hygiene

    # 5. Portfolio constraints ---------------------------------------------- #
    portfolio = snapshot["portfolio"]
    holdings = portfolio["holdings"]
    total_weight = sum(row["finalWeight"] for row in holdings)
    sector_totals: dict[str, float] = {}
    for row in holdings:
        sector_totals[row["sector"]] = sector_totals.get(row["sector"], 0.0) + row["finalWeight"]
    checks["portfolio"] = {
        "holdings": len(holdings),
        "total_weight": round(total_weight, 2),
        "max_single_weight": max(row["finalWeight"] for row in holdings),
        "max_sector_weight": round(max(sector_totals.values()), 2),
        "raw_formula_max_error": round(max(
            abs(
                row["rawWeight"]
                - row["float_market_cap"] * row["score"]
                / sum(item["float_market_cap"] * item["score"] for item in holdings)
                * 100
            )
            for row in holdings
        ), 6),
        "float_caps_available": all(row.get("float_market_cap", 0) > 0 for row in holdings),
        "sector_totals": {key: round(value, 1) for key, value in sector_totals.items()},
        "all_constraints_pass": all(item["passed"] for item in portfolio["constraints"]),
        "excluded_without_market_cap": portfolio.get("excluded_no_market_cap", []),
    }

    # 6. Backtest sanity ----------------------------------------------------- #
    bt = snapshot["backtest"]["top100"]
    strategy = bt["strategy"]
    checks["backtest"] = {
        "available": bt["available"],
        "window": [bt["start"], bt["end"]],
        "points": len(strategy),
        "no_nan": all(isinstance(value, (int, float)) and not math.isnan(value) for value in strategy),
        "starts_below_100_by_initial_cost": 99.8 <= strategy[0] < 100.0,
        "drawdown_non_positive": max(bt["drawdown"]) <= 0.0,
        "metrics": bt["metrics"],
        "rebalances": bt["rebalances"],
        "rebalance_months": sorted({
            point["signal_date"][5:7] for point in bt.get("rebalance_log", [])
        }),
        "execution_after_signal": all(
            point["execution_date"] > point["signal_date"]
            for point in bt.get("rebalance_log", [])
        ),
        "transaction_costs_applied": bt["metrics"].get("transaction_cost_pct", 0) > 0,
        "risk_free_rate_documented": bt["metrics"].get("risk_free_rate") == 0.0,
        "annual_years": [row["year"] for row in bt["annual"]],
    }
    checks["backtest_top20"] = snapshot["backtest"]["top20"]["metrics"]

    # 7. Cross-provider price comparison ------------------------------------ #
    cross = {}
    demos = {"AAPL": "AAPL", "QQQ": "QQQ"}
    for yahoo_symbol, td_symbol in demos.items():
        try:
            with urllib.request.urlopen(
                f"https://api.twelvedata.com/time_series?symbol={td_symbol}&interval=1day&outputsize=1&apikey=demo",
                timeout=25,
            ) as response:
                td = json.load(response)
            td_row = (td.get("values") or [{}])[0]
            app_row = next((row for row in stocks if row["ticker"] == yahoo_symbol), None)
            cross[yahoo_symbol] = {
                "twelve_data": {"date": td_row.get("datetime"), "close": float(td_row.get("close", "nan"))},
                "yahoo_via_app": {"date": app_row["date"], "close": app_row["price"]} if app_row else None,
            }
            if app_row and td_row.get("close"):
                cross[yahoo_symbol]["difference_pct"] = round(
                    (app_row["price"] / float(td_row["close"]) - 1) * 100, 3
                )
        except Exception as exc:  # noqa: BLE001
            cross[yahoo_symbol] = {"error": f"{type(exc).__name__}: {exc}"}
    checks["cross_provider_prices"] = cross

    # 8. Source provenance --------------------------------------------------- #
    checks["provenance"] = {
        "providers": sorted({row["sourceLabel"] for row in stocks}),
        "primary": snapshot["meta"]["data_provider"],
        "is_backup": snapshot["meta"]["is_backup"],
        "backup_symbols": snapshot["meta"]["backup_symbols"],
        "timeliness": snapshot["meta"]["timeliness"],
        "generated_at": snapshot["meta"]["generated_at"],
        "all_rows_carry_source": all(bool(row["source"]) and bool(row["date"]) for row in stocks),
    }

    checks["passed"] = all(
        [
            checks["universe"]["all_meet_minimum"],
            checks["universe"]["no_null_prices"],
            checks["universe"]["single_as_of_date"],
            checks["ranking"]["strictly_ordered"],
            checks["momentum_recompute"]["all_within_tolerance"],
            checks["portfolio"]["all_constraints_pass"],
            checks["portfolio"]["raw_formula_max_error"] < 0.001,
            checks["portfolio"]["float_caps_available"],
            abs(total_weight - 100) < 0.1,
            checks["backtest"]["no_nan"],
            checks["backtest"]["starts_below_100_by_initial_cost"],
            checks["backtest"]["rebalance_months"] == ["03", "09"],
            checks["backtest"]["execution_after_signal"],
            checks["backtest"]["transaction_costs_applied"],
            checks["backtest"]["risk_free_rate_documented"],
        ]
    )

    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "verification.json").write_text(json.dumps(report, indent=2, default=str))

    print(json.dumps(report, indent=2, default=str))
    print("\nPASSED" if checks["passed"] else "\nFAILED")
    return 0 if checks["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

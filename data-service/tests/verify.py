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
# The three symbols the 12-1 chart audit is signed off against, re-signed on
# each audited publication. These are a drift alarm for the vendor's adjusted
# history, not a formula: the formula itself is asserted by
# ``test_quantitative`` and by the window/endpoint checks below.
CHART_AUDIT = {"MPC": 146.3, "MU": 280.7, "HPE": 154.2}


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
        # Volatility uses the same observation window as the 12-1 signal: the
        # 232 closes from t-252 through t-21, i.e. 231 daily returns. The
        # 21-session skip month is deliberately excluded from both.
        daily = [(closes[i] / closes[i - 1] - 1) for i in range(len(closes) - 252, len(closes) - 21)]
        mean = sum(daily) / len(daily)
        daily_std = math.sqrt(sum((value - mean) ** 2 for value in daily) / (len(daily) - 1))
        vol = daily_std * math.sqrt(252) * 100
        risk_adjusted = (closes[-22] / closes[-253] - 1) / daily_std
        expected_score = 1 + app["zScore"] if app["zScore"] > 0 else (
            1 / (1 - app["zScore"]) if app["zScore"] < 0 else 1
        )
        sparkline = app.get("sparkline12_1") or {}
        sparkline_values = sparkline.get("values") or []
        sparkline_return = (
            (sparkline_values[-1] / sparkline_values[0] - 1) * 100
            if len(sparkline_values) >= 2
            else None
        )
        expected_start_bar = bars[-253]
        expected_end_bar = bars[-22]
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
            "sparkline_start_date": sparkline.get("startDate"),
            "sparkline_end_date": sparkline.get("endDate"),
            "sparkline_start_adjusted_close": sparkline.get("startAdjustedClose"),
            "sparkline_end_adjusted_close": sparkline.get("endAdjustedClose"),
            "sparkline_first_point": sparkline_values[0] if sparkline_values else None,
            "sparkline_last_point": sparkline_values[-1] if sparkline_values else None,
            "sparkline_return_pct": round(sparkline_return, 4) if sparkline_return is not None else None,
            "sparkline_window_matches_bars": bool(
                sparkline.get("startDate") == expected_start_bar["date"]
                and sparkline.get("endDate") == expected_end_bar["date"]
                and abs((sparkline.get("startAdjustedClose") or 0) - expected_start_bar["adjusted_close"]) < 0.001
                and abs((sparkline.get("endAdjustedClose") or 0) - expected_end_bar["adjusted_close"]) < 0.001
            ),
            "sparkline_return_matches_displayed": bool(
                sparkline_return is not None and abs(sparkline_return - app["momentum"]) < 0.1
            ),
        }
    checks["momentum_recompute"] = {
        "tickers": recomputed,
        "all_within_tolerance": all(
            item["delta"] < 1.0
            and abs(item["volatility_recomputed"] - item["volatility_app"]) < 0.2
            and abs(item["risk_adjusted_recomputed"] - item["risk_adjusted_app"]) < 0.02
            and item["score_delta_from_displayed_z"] < 0.03
            and item["sparkline_window_matches_bars"]
            and item["sparkline_return_matches_displayed"]
            for item in recomputed.values()
        ),
    }

    # 3b. One momentum series for both chart sizes -------------------------- #
    # The Screener sparkline reads the publication row; the Stock Analysis chart
    # reads the same block from /api/stock/{ticker}. They must be byte-identical
    # apart from nothing at all - same window, same base, same endpoint.
    chart_audit = {}
    for ticker, expected_momentum in CHART_AUDIT.items():
        row = next((item for item in stocks if item["ticker"] == ticker), None)
        detail = get(f"/api/stock/{ticker}") if row else {}
        publication_series = (row or {}).get("sparkline12_1") or {}
        detail_series = detail.get("sparkline12_1") or {}
        pub_values = publication_series.get("values") or []
        detail_values = detail_series.get("values") or []
        bars = get(f"/api/bars/{ticker}?days=800")["bars"] if row else []
        expected_start = bars[-253] if len(bars) >= 253 else {}
        expected_end = bars[-22] if len(bars) >= 22 else {}
        endpoint_index = pub_values[-1] if pub_values else None
        chart_audit[ticker] = {
            "ticker": ticker,
            "start_date": publication_series.get("startDate"),
            "end_date": publication_series.get("endDate"),
            "start_adjusted_close": publication_series.get("startAdjustedClose"),
            "end_adjusted_close": publication_series.get("endAdjustedClose"),
            "momentum_12_1_pct": (row or {}).get("momentum"),
            "expected_momentum_pct": expected_momentum,
            "first_indexed_value": pub_values[0] if pub_values else None,
            "last_indexed_value": endpoint_index,
            "expected_last_indexed_value": round(100 * (1 + expected_momentum / 100), 4),
            "screener_and_stock_analysis_identical": bool(
                pub_values and detail_values and pub_values == detail_values
            ),
            "window_matches_bars": bool(
                publication_series.get("startDate") == expected_start.get("date")
                and publication_series.get("endDate") == expected_end.get("date")
                and abs((publication_series.get("startAdjustedClose") or 0) - (expected_start.get("adjusted_close") or 0)) < 0.001
                and abs((publication_series.get("endAdjustedClose") or 0) - (expected_end.get("adjusted_close") or 0)) < 0.001
            ),
            "endpoint_matches_displayed_momentum": bool(
                endpoint_index is not None
                and abs((endpoint_index / 100 - 1) * 100 - ((row or {}).get("momentum") or 0)) < 0.05
            ),
            "momentum_within_expected_band": bool(
                row and abs(row["momentum"] - expected_momentum) < 1.0
            ),
            "base_is_one_hundred": bool(pub_values and pub_values[0] == 100.0),
        }
    checks["momentum_chart_consistency"] = {
        "tickers": chart_audit,
        "all_identical_across_sizes": all(
            item["screener_and_stock_analysis_identical"] for item in chart_audit.values()
        ),
        "all_windows_match_bars": all(item["window_matches_bars"] for item in chart_audit.values()),
        "all_endpoints_match": all(
            item["endpoint_matches_displayed_momentum"] for item in chart_audit.values()
        ),
        "all_bases_are_one_hundred": all(item["base_is_one_hundred"] for item in chart_audit.values()),
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

    # The audit recomputes both rules independently instead of importing them:
    # selection is score-only, sizing is score x relative-sqrt float cap.
    caps = sorted(row["float_market_cap"] for row in holdings)
    middle = len(caps) // 2
    median_cap = caps[middle] if len(caps) % 2 else (caps[middle - 1] + caps[middle]) / 2
    raw = {
        row["ticker"]: row["score"] * math.sqrt(row["float_market_cap"] / median_cap)
        for row in holdings
    }
    raw_total = sum(raw.values())

    sector_totals: dict[str, float] = {}
    for row in holdings:
        sector_totals[row["sector"]] = sector_totals.get(row["sector"], 0.0) + row["finalWeight"]
    # The 35% cap is enforced on combined groups, so the audit measures the same
    # scope. This mapping deliberately mirrors the published rule.
    group_map = {
        "Consumer Discretionary": "Consumer",
        "Consumer Staples": "Consumer",
        "Financials": "Others",
        "Energy": "Others",
        "Materials": "Others",
        "Utilities": "Others",
        "Real Estate": "Others",
    }
    group_totals: dict[str, float] = {}
    for row in holdings:
        group = group_map.get(row["sector"], row["sector"])
        group_totals[group] = group_totals.get(group, 0.0) + row["finalWeight"]

    checks["portfolio"] = {
        "holdings": len(holdings),
        "total_weight": round(total_weight, 2),
        "max_single_weight": max(row["finalWeight"] for row in holdings),
        "max_sector_weight": round(max(sector_totals.values()), 2),
        "max_sector_group_weight": round(max(group_totals.values()), 2),
        "sector_group_totals": {key: round(value, 1) for key, value in group_totals.items()},
        "median_float_cap": median_cap,
        "published_market_cap_exponent": portfolio.get("weighting", {}).get("marketCapExponent"),
        "published_methodology": portfolio.get("weighting", {}).get("methodologyId"),
        "selection_rule": portfolio.get("selection", {}).get("rule"),
        "raw_formula_max_error": round(max(
            abs(row["rawWeight"] - raw[row["ticker"]] / raw_total * 100)
            for row in holdings
        ), 6),
        "selection_is_score_ordered": all(
            holdings[index]["score"] >= holdings[index + 1]["score"]
            for index in range(len(holdings) - 1)
        ),
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
    price_strategy = bt.get("priceStrategy", [])
    dividend_coverage = bt.get("dividendCoverage") or {}
    cpi = (snapshot.get("macro") or {}).get("cpi") or {}
    checks["backtest_return_modes"] = {
        "price_points": len(price_strategy),
        "price_dates_match": len(price_strategy) == len(bt["dates"]),
        "price_benchmarks_present": bool(bt.get("priceSpy")) and bool(bt.get("priceSpmo")),
        "modes_are_distinct": bool(price_strategy) and price_strategy[-1] != strategy[-1],
        "dividend_securities_checked": dividend_coverage.get("securities_checked", 0),
        "dividend_coverage_complete": dividend_coverage.get("incomplete_securities") == 0,
        "cpi_available": bool(cpi.get("available")),
        "cpi_observations": len(cpi.get("observations") or []),
        "cpi_missing_months": cpi.get("missing_months") or [],
        "cpi_source": cpi.get("source"),
    }
    cashflow_accounts = bt.get("cashflowAccounts") or {}
    cashflow_by_id = cashflow_accounts.get("accounts") or {}
    cashflow_dates = {
        key: [event.get("date") for event in account.get("events", [])]
        for key, account in cashflow_by_id.items()
    }
    checks["backtest_cashflow_accounts"] = {
        "config": cashflow_accounts.get("config"),
        "accounts": sorted(cashflow_by_id),
        "timeline_lengths": {
            key: len(account.get("balances") or [])
            for key, account in cashflow_by_id.items()
        },
        "timeline_lengths_match": all(
            len(account.get("balances") or []) == len(bt["dates"])
            for account in cashflow_by_id.values()
        ),
        "identical_requested_dates": len({
            tuple(cashflow_dates.get(key, []))
            for key in ("strategy", "spy", "spmo")
        }) == 1,
        "balances_reconcile": all(
            abs(
                float(account.get("final_value", 0.0))
                - (
                    float(account.get("ending_holdings_value", 0.0))
                    + float(account.get("ending_cash", 0.0))
                )
            ) < 1e-8
            for account in cashflow_by_id.values()
        ),
        "no_negative_balances": all(
            all(float(value) >= 0.0 for value in account.get("balances") or [])
            for account in cashflow_by_id.values()
        ),
        "strategy_twr_matches_nav": abs(
            float(cashflow_by_id.get("strategy", {}).get("time_weighted_return_pct", 0.0))
            - float(bt["metrics"]["cumulative_return"])
        ) < 0.15,
        "benchmark_twr_matches_series": {
            key: abs(
                float(cashflow_by_id.get(key, {}).get("time_weighted_return_pct", 0.0))
                - ((bt[key][-1] / bt[key][0] - 1.0) * 100.0)
            ) < 0.15
            for key in ("spy", "spmo")
        },
    }

    # 6b. Every backtest chart reconciles with the published NAV series ------ #
    nav = bt["strategy"]
    peak = nav[0]
    worst = 0.0
    for value in nav:
        peak = max(peak, value)
        worst = min(worst, (value / peak - 1) * 100)
    observed_days = max(1, (datetime.fromisoformat(bt["end"]) - datetime.fromisoformat(bt["start"])).days)
    total = nav[-1] / 100.0
    recomputed_metrics = {
        "cumulative_return": round((total - 1.0) * 100, 1),
        "cagr": round((total ** (365.0 / observed_days) - 1.0) * 100, 1) if total > 0 else None,
        "max_drawdown": round(worst, 1),
    }
    checks["backtest_chart_reconciliation"] = {
        "nav_points": len(nav),
        "dates_match_points": len(bt["dates"]) == len(nav),
        "drawdown_matches_points": len(bt["drawdown"]) == len(nav),
        "cumulative_return_series": recomputed_metrics["cumulative_return"],
        "cumulative_return_published": bt["metrics"]["cumulative_return"],
        "cumulative_return_delta": round(abs(recomputed_metrics["cumulative_return"] - bt["metrics"]["cumulative_return"]), 2),
        "cagr_series": recomputed_metrics["cagr"],
        "cagr_published": bt["metrics"]["cagr"],
        "max_drawdown_series": recomputed_metrics["max_drawdown"],
        "max_drawdown_published": bt["metrics"]["max_drawdown"],
        "benchmarks_rebased_to_100": {
            "spy": bool(bt["spy"]) and abs(bt["spy"][0] - 100.0) < 0.02,
            "spmo": bool(bt["spmo"]) and abs(bt["spmo"][0] - 100.0) < 0.02,
        },
        # The annual table is intentionally capped to its most recent eight
        # calendar years, so only that tail can be reconciled with the NAV.
        "annual_years_match_nav": sorted({int(date[:4]) for date in bt["dates"]})[-len(bt["annual"]):] == [
            row["year"] for row in bt["annual"]
        ],
        "ytd_label_needed": int(bt["end"][:4]) == bt["annual"][-1]["year"] if bt["annual"] else False,
        "annual_return_deltas": [
            {
                "year": row["year"],
                "published": row["strategy"],
                "recomputed": round(
                    (nav[max(index for index, date in enumerate(bt["dates"]) if int(date[:4]) == row["year"])]
                     / nav[max(0, min(index for index, date in enumerate(bt["dates"]) if int(date[:4]) == row["year"]) - 1)]
                     - 1) * 100,
                    1,
                ),
            }
            for row in bt["annual"]
        ],
    }
    checks["backtest_chart_reconciliation"]["all_reconcile"] = all([
        checks["backtest_chart_reconciliation"]["dates_match_points"],
        checks["backtest_chart_reconciliation"]["drawdown_matches_points"],
        checks["backtest_chart_reconciliation"]["cumulative_return_delta"] < 0.15,
        abs((checks["backtest_chart_reconciliation"]["cagr_series"] or 0) - (bt["metrics"]["cagr"] or 0)) < 0.15,
        abs(recomputed_metrics["max_drawdown"] - bt["metrics"]["max_drawdown"]) < 0.15,
        all(checks["backtest_chart_reconciliation"]["benchmarks_rebased_to_100"].values()),
        checks["backtest_chart_reconciliation"]["annual_years_match_nav"],
    ])

    # 6c. Overview performance chart vs the backtest it claims to plot -------- #
    performance = (snapshot.get("overview") or {}).get("performance") or {}
    all_period = performance.get("All") or {}
    series_by_id = {item["id"]: item for item in all_period.get("series", [])}
    checks["overview_performance"] = {
        "periods": sorted(performance.keys()),
        "series_ids": sorted(series_by_id),
        "all_series_present": {"strategy", "spy", "spmo"} <= set(series_by_id),
        "strategy_end_matches_backtest": bool(series_by_id.get("strategy")) and abs(
            float(series_by_id["strategy"]["end"].rstrip("%").replace("+", ""))
            - bt["metrics"]["cumulative_return"]
        ) < 0.2,
        "dates_match_points": all(
            len(block.get("dates", [])) == block.get("points", 0) for block in performance.values()
        ),
        "month_ticks_are_dated_and_inside_the_window": all(
            all(
                tick.get("date", "") and block["dates"][0] <= tick["date"] <= block["dates"][-1]
                for tick in block.get("ticks", [])
            )
            for block in performance.values()
        ),
        "series_match_points": all(
            all(len(item["values"]) == block.get("points", 0) for item in block.get("series", []))
            for block in performance.values()
        ),
        "axis_contains_every_value": all(
            min(min(item["values"]) for item in block["series"]) >= block["axis"]["min"]
            and max(max(item["values"]) for item in block["series"]) <= block["axis"]["max"]
            for block in performance.values()
        ),
    }

    # 6d. Portfolio charts: donut, legend and holdings are one dataset -------- #
    overview_alloc = (snapshot.get("overview") or {}).get("sectorAllocation") or []
    holdings_by_sector: dict[str, float] = {}
    for holding in holdings:
        holdings_by_sector[holding["sector"]] = holdings_by_sector.get(holding["sector"], 0.0) + holding["finalWeight"]
    donut = {row["name"]: row["value"] for row in portfolio.get("sectors") or []}
    checks["portfolio_charts"] = {
        "holdings": len(holdings),
        "total_final_weight": round(total_weight, 6),
        "weights_sum_to_100": abs(total_weight - 100.0) < 0.01,
        "max_stock_weight": max(row["finalWeight"] for row in holdings),
        "max_sector_weight": round(max(holdings_by_sector.values()), 4),
        "donut_matches_holdings": {
            name: {
                "donut": donut.get(name),
                "holdings": round(value, 1),
                "delta": round(abs((donut.get(name) or 0.0) - value), 2),
            }
            for name, value in sorted(holdings_by_sector.items())
        },
        "donut_covers_every_sector": set(donut) == set(holdings_by_sector),
        "overview_allocation_sums_to_100": sum(row["value"] for row in overview_alloc) == 100,
        "overview_allocation_matches_donut": {
            row["name"]: {"overview": row["value"], "donut": round(donut.get(row["name"], 0.0))}
            for row in overview_alloc
        },
        "weight_distribution_uses_final_weight": all(
            isinstance(row["finalWeight"], (int, float)) and row["finalWeight"] > 0 for row in holdings
        ),
    }
    checks["portfolio_charts"]["all_consistent"] = bool(
        checks["portfolio_charts"]["weights_sum_to_100"]
        and checks["portfolio_charts"]["donut_covers_every_sector"]
        and max(item["delta"] for item in checks["portfolio_charts"]["donut_matches_holdings"].values()) < 0.15
        and checks["portfolio_charts"]["overview_allocation_sums_to_100"]
        and checks["portfolio_charts"]["max_stock_weight"] <= 9.0 + 1e-6
        and checks["portfolio_charts"]["max_sector_weight"] <= 35.0 + 1e-6
    )

    # 6d2. Overview Top Momentum list is the head of the Screener ------------ #
    top_momentum = (snapshot.get("overview") or {}).get("topMomentum") or []
    checks["overview_top_momentum"] = {
        "rows": len(top_momentum),
        "matches_first_ranks": [
            {
                "rank": item["rank"],
                "ticker": item["ticker"],
                "screener_ticker": stocks[index]["ticker"],
                "score": item["score"],
                "screener_score": f"{stocks[index]['score']:.2f}",
                "price": item["price"],
                "screener_price": f"${stocks[index]['price']:.2f}",
                "consistent": (
                    item["ticker"] == stocks[index]["ticker"]
                    and item["rank"] == stocks[index]["rank"]
                    and item["score"] == f"{stocks[index]['score']:.2f}"
                    and item["price"] == f"${stocks[index]['price']:.2f}"
                ),
            }
            for index, item in enumerate(top_momentum)
        ],
        # The miniature on this card is a trailing 12-week price path, not the
        # 12-1 momentum series. Recorded explicitly so the two are never
        # mistaken for one another.
        "sparkline_series": "trend (12 weekly adjusted closes, rebased to 100)",
        "same_series_as_screener": False,
    }
    checks["overview_top_momentum"]["all_consistent"] = all(
        row["consistent"] for row in checks["overview_top_momentum"]["matches_first_ranks"]
    )

    # 6e. Cross-page field consistency (Screener vs Stock Analysis) ---------- #
    cross_page = {}
    for ticker in ("MPC", "MU", "HPE", "NVDA", "JPM"):
        row = next((item for item in stocks if item["ticker"] == ticker), None)
        if row is None:
            continue
        detail = get(f"/api/stock/{ticker}")
        cross_page[ticker] = {
            "price": {"screener": row["price"], "stock": detail.get("price"), "equal": row["price"] == detail.get("price")},
            "marketCap": {
                "screener": row["marketCap"],
                "stock": detail.get("marketCap"),
                "equal": row["marketCap"] == detail.get("marketCap"),
            },
            "momentum": {
                "screener": row["momentum"],
                "stock": detail.get("momentum"),
                "equal": row["momentum"] == detail.get("momentum"),
            },
            "score": {
                "screener": row["score"],
                "stock": detail.get("score"),
                "equal": row["score"] == detail.get("score"),
            },
            "rank": {"screener": row["rank"], "stock": detail.get("rank"), "equal": row["rank"] == detail.get("rank")},
            "sector": {
                "screener": row["sector"],
                "stock": detail.get("sector"),
                "equal": row["sector"] == detail.get("sector"),
            },
            "snapshot_stamp": detail.get("_snapshot") == snapshot["meta"]["generated_at"],
        }
    checks["cross_page_consistency"] = {
        "tickers": cross_page,
        "all_equal": all(
            all(field["equal"] for key, field in item.items() if isinstance(field, dict) and "equal" in field)
            for item in cross_page.values()
        ),
        "same_snapshot": all(item["snapshot_stamp"] for item in cross_page.values()),
    }

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
            checks["momentum_chart_consistency"]["all_identical_across_sizes"],
            checks["momentum_chart_consistency"]["all_windows_match_bars"],
            checks["momentum_chart_consistency"]["all_endpoints_match"],
            checks["momentum_chart_consistency"]["all_bases_are_one_hundred"],
            checks["backtest_chart_reconciliation"]["all_reconcile"],
            checks["backtest_return_modes"]["price_dates_match"],
            checks["backtest_return_modes"]["price_benchmarks_present"],
            checks["backtest_return_modes"]["modes_are_distinct"],
            checks["backtest_return_modes"]["dividend_coverage_complete"],
            checks["backtest_return_modes"]["cpi_available"],
            checks["backtest_cashflow_accounts"]["config"]["enabled"] is True,
            checks["backtest_cashflow_accounts"]["accounts"] == ["spmo", "spy", "strategy"],
            checks["backtest_cashflow_accounts"]["timeline_lengths_match"],
            checks["backtest_cashflow_accounts"]["identical_requested_dates"],
            checks["backtest_cashflow_accounts"]["balances_reconcile"],
            checks["backtest_cashflow_accounts"]["no_negative_balances"],
            checks["backtest_cashflow_accounts"]["strategy_twr_matches_nav"],
            all(checks["backtest_cashflow_accounts"]["benchmark_twr_matches_series"].values()),
            checks["overview_performance"]["strategy_end_matches_backtest"],
            checks["portfolio_charts"]["all_consistent"],
            checks["overview_top_momentum"]["all_consistent"],
            checks["cross_page_consistency"]["all_equal"],
            checks["cross_page_consistency"]["same_snapshot"],
            checks["portfolio"]["all_constraints_pass"],
            checks["portfolio"]["raw_formula_max_error"] < 0.001,
            checks["portfolio"]["float_caps_available"],
            checks["portfolio"]["max_sector_group_weight"] <= 35.01,
            checks["portfolio"]["published_market_cap_exponent"] == 0.5,
            checks["portfolio"]["selection_is_score_ordered"],
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

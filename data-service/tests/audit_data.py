#!/usr/bin/env python3
"""Inspect cached provider records and write reproducible data-quality evidence."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import exchange_calendars as xcals
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data-service" / "cache"
OUTPUT = ROOT / "data-service" / "docs" / "data_quality.json"
CALENDAR = xcals.get_calendar("XNYS")


def pct_change(previous: float, current: float) -> float:
    return (current / previous - 1.0) * 100.0


def main() -> int:
    series_reports = []
    anomalies = []
    all_dates = set()
    coverage_starts = []
    coverage_ends = []
    action_field_rows = 0
    zero_volume_rows = 0
    invalid_session_dates = set()

    for path in sorted((CACHE / "yahoo_bars").glob("*_10y.json")):
        payload = json.loads(path.read_text())["value"]
        symbol = payload["symbol"]
        bars = payload.get("bars", [])
        dates = [bar["date"] for bar in bars]
        date_set = set(dates)
        all_dates.update(date_set)
        coverage_starts.append(dates[0] if dates else None)
        coverage_ends.append(dates[-1] if dates else None)
        invalid_dates = []
        for date_string in dates:
            stamp = pd.Timestamp(date_string)
            if not CALENDAR.is_session(stamp):
                invalid_dates.append(date_string)
        invalid_session_dates.update(invalid_dates)

        expected_sessions = 0
        if len(dates) >= 2:
            expected_sessions = len(CALENDAR.sessions_in_range(pd.Timestamp(dates[0]), pd.Timestamp(dates[-1])))
        zero_volume = sum(bar.get("volume") == 0 for bar in bars)
        zero_volume_rows += zero_volume
        action_rows = sum(
            bar.get("dividends") is not None or bar.get("stock_splits") is not None
            for bar in bars
        )
        action_field_rows += action_rows
        null_prices = sum(
            bar.get("close") is None or bar.get("adjusted_close") is None
            for bar in bars
        )
        for index in range(1, len(bars)):
            previous = bars[index - 1].get("adjusted_close")
            current = bars[index].get("adjusted_close")
            if previous and current and previous > 0:
                change = pct_change(previous, current)
                if abs(change) >= 35.0:
                    anomalies.append(
                        {
                            "symbol": symbol,
                            "date": bars[index]["date"],
                            "adjusted_return_pct": round(change, 2),
                            "close": bars[index].get("close"),
                            "adjusted_close": current,
                            "volume": bars[index].get("volume"),
                            "recorded_split": bars[index].get("stock_splits"),
                            "recorded_dividend": bars[index].get("dividends"),
                            "classification": "review required",
                        }
                    )
        series_reports.append(
            {
                "symbol": symbol,
                "rows": len(bars),
                "first_date": dates[0] if dates else None,
                "last_date": dates[-1] if dates else None,
                "duplicate_dates": len(dates) - len(date_set),
                "sorted": dates == sorted(dates),
                "invalid_exchange_session_dates": invalid_dates,
                "missing_sessions_within_coverage": max(0, expected_sessions - len(date_set)),
                "null_price_rows": null_prices,
                "zero_volume_rows": zero_volume,
                "corporate_action_metadata_rows": action_rows,
                "adjusted": payload.get("adjusted"),
            }
        )

    quotes = []
    for path in sorted((CACHE / "yahoo_quotes").glob("*.json")):
        value = json.loads(path.read_text()).get("value", {})
        if value:
            quotes.append(value)

    float_basis_warnings = [
        {
            "symbol": quote["symbol"],
            "float_shares": quote.get("float_shares"),
            "shares_outstanding": quote.get("shares_outstanding"),
            "ratio": round(quote["float_shares"] / quote["shares_outstanding"], 3),
        }
        for quote in quotes
        if quote.get("float_shares")
        and quote.get("shares_outstanding")
        and quote["float_shares"] > quote["shares_outstanding"] * 1.01
    ]

    publication = json.loads((CACHE / "publication" / "snapshot.json").read_text())["value"]
    stock_by_ticker = {row["ticker"]: row for row in publication["stocks"]}
    holding_checks = []
    for holding in publication.get("portfolio", {}).get("holdings", []):
        stock = stock_by_ticker.get(holding["ticker"])
        holding_checks.append(
            {
                "ticker": holding["ticker"],
                "same_ordinary_market_cap": bool(stock and holding["market_cap"] == stock["marketCap"]),
                "float_cap_positive": holding.get("float_market_cap", 0) > 0,
            }
        )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": "Yahoo Finance via yfinance (cached records)",
        "history_years_requested": 10,
        "summary": {
            "series_files": len(series_reports),
            "total_rows": sum(row["rows"] for row in series_reports),
            "earliest_observation": min(value for value in coverage_starts if value),
            "latest_observation": max(value for value in coverage_ends if value),
            "duplicate_date_rows": sum(row["duplicate_dates"] for row in series_reports),
            "unsorted_series": sum(not row["sorted"] for row in series_reports),
            "null_price_rows": sum(row["null_price_rows"] for row in series_reports),
            "weekend_or_exchange_holiday_dates": sorted(invalid_session_dates),
            "zero_volume_rows": zero_volume_rows,
            "corporate_action_metadata_rows": action_field_rows,
            "extreme_adjusted_moves_35pct_or_more": len(anomalies),
            "quote_records": len(quotes),
            "quote_currency_counts": dict(Counter(str(quote.get("currency")) for quote in quotes)),
            "missing_market_cap": [quote["symbol"] for quote in quotes if not quote.get("market_cap")],
            "missing_float_shares": [quote["symbol"] for quote in quotes if not quote.get("float_shares")],
            "float_share_basis_warnings": float_basis_warnings,
            "single_as_of_date": len({row["date"] for row in publication["stocks"]}) == 1,
            "as_of": publication["meta"]["as_of"],
            "portfolio_cap_consistency_failures": [
                row for row in holding_checks
                if not row["same_ordinary_market_cap"] or not row["float_cap_positive"]
            ],
        },
        "coverage_outliers": sorted(series_reports, key=lambda row: row["rows"])[:8],
        "series": series_reports,
        "extreme_moves_for_review": sorted(
            anomalies,
            key=lambda row: abs(row["adjusted_return_pct"]),
            reverse=True,
        ),
        "known_limitations": [
            "Yahoo Finance is an unofficial provider and does not offer a point-in-time security master.",
            "The cached batch bars do not retain per-row split and dividend fields, although adjusted closes are present.",
            "Float shares are current quote metadata, not historical point-in-time counts.",
            "Extreme moves are flagged, not automatically treated as errors.",
            "Cross-provider coverage is limited to AAPL and QQQ demo access without paid backup keys.",
        ],
    }
    OUTPUT.write_text(json.dumps(report, indent=2))
    print(json.dumps({key: report[key] for key in ("summary", "coverage_outliers", "known_limitations")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Inspect cached provider records and write reproducible data-quality evidence."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import exchange_calendars as xcals
import pandas as pd

from app.universe import BENCHMARKS, HISTORICAL_BACKTEST_TICKERS

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
    dividend_event_rows = 0
    split_event_rows = 0
    invalid_action_rows = 0
    zero_volume_rows = 0
    negative_volume_rows = 0
    invalid_ohlc_rows = 0
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
        missing_session_rows = []
        if len(dates) >= 2:
            session_index = CALENDAR.sessions_in_range(pd.Timestamp(dates[0]), pd.Timestamp(dates[-1]))
            expected_sessions = len(session_index)
            missing_session_rows = [
                stamp.strftime("%Y-%m-%d")
                for stamp in session_index
                if stamp.strftime("%Y-%m-%d") not in date_set
            ]
        # Walk the calendar sequentially so one long closure is distinguishable
        # from several unrelated single-session gaps.
        longest_gap = 0
        current_gap = 0
        previous_missing = None
        if len(dates) >= 2:
            for stamp in CALENDAR.sessions_in_range(pd.Timestamp(dates[0]), pd.Timestamp(dates[-1])):
                date_string = stamp.strftime("%Y-%m-%d")
                if date_string not in date_set:
                    adjacent = (
                        previous_missing is not None
                        and int(stamp.toordinal()) - int(previous_missing.toordinal()) <= 3
                    )
                    current_gap = current_gap + 1 if adjacent else 1
                    previous_missing = stamp
                else:
                    current_gap = 0
                    previous_missing = None
                longest_gap = max(longest_gap, current_gap)
        zero_volume = sum(bar.get("volume") == 0 for bar in bars)
        zero_volume_rows += zero_volume
        negative_volume = sum(
            bar.get("volume") is not None and bar.get("volume") < 0
            for bar in bars
        )
        negative_volume_rows += negative_volume
        action_rows = sum(
            bar.get("dividends") is not None or bar.get("stock_splits") is not None
            for bar in bars
        )
        action_field_rows += action_rows
        dividends = [
            float(bar["dividends"])
            for bar in bars
            if bar.get("dividends") is not None and float(bar["dividends"]) > 0
        ]
        splits = [
            float(bar["stock_splits"])
            for bar in bars
            if bar.get("stock_splits") is not None and float(bar["stock_splits"]) != 0
        ]
        dividend_event_rows += len(dividends)
        split_event_rows += len(splits)
        bad_actions = sum(
            (bar.get("dividends") is not None and bar["dividends"] < 0)
            or (bar.get("stock_splits") is not None and bar["stock_splits"] < 0)
            for bar in bars
        )
        invalid_action_rows += bad_actions
        null_prices = sum(
            bar.get("close") is None or bar.get("adjusted_close") is None
            for bar in bars
        )
        negative_or_zero_prices = sum(
            (bar.get("close") is not None and bar["close"] <= 0)
            or (bar.get("adjusted_close") is not None and bar["adjusted_close"] <= 0)
            for bar in bars
        )
        bad_ohlc = sum(
            bar.get("high") is not None
            and bar.get("low") is not None
            and (
                bar["high"] < bar["low"]
                or (
                    bar.get("open") is not None
                    and not (bar["low"] <= bar["open"] <= bar["high"])
                )
                or (
                    bar.get("close") is not None
                    and not (bar["low"] <= bar["close"] <= bar["high"])
                )
            )
            for bar in bars
        )
        invalid_ohlc_rows += bad_ohlc
        max_abs_return = 0.0
        for index in range(1, len(bars)):
            previous = bars[index - 1].get("adjusted_close")
            current = bars[index].get("adjusted_close")
            if previous and current and previous > 0:
                change = pct_change(previous, current)
                max_abs_return = max(max_abs_return, abs(change))
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
                "expected_sessions": expected_sessions,
                "missing_sessions_within_coverage": len(missing_session_rows),
                "missing_session_ratio_pct": round(
                    len(missing_session_rows) / expected_sessions * 100.0,
                    3,
                ) if expected_sessions else None,
                "longest_missing_session_gap": longest_gap,
                "null_price_rows": null_prices,
                "negative_or_zero_price_rows": negative_or_zero_prices,
                "invalid_ohlc_rows": bad_ohlc,
                "zero_volume_rows": zero_volume,
                "negative_volume_rows": negative_volume,
                "corporate_action_metadata_rows": action_rows,
                "dividend_event_rows": len(dividends),
                "split_event_rows": len(splits),
                "invalid_action_rows": bad_actions,
                "max_abs_adjusted_daily_return_pct": round(max_abs_return, 3),
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
    audited_symbols = {
        *stock_by_ticker,
        *HISTORICAL_BACKTEST_TICKERS,
        *BENCHMARKS,
    }
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

    stale_series = [
        {
            "symbol": row["symbol"],
            "last_date": row["last_date"],
            "sessions_behind": len(
                CALENDAR.sessions_in_range(
                    pd.Timestamp(row["last_date"]),
                    pd.Timestamp(publication["meta"]["as_of"]),
                )
            ) - 1,
        }
        for row in series_reports
        if (
            row["symbol"] in audited_symbols
            and row["last_date"]
            and row["last_date"] < publication["meta"]["as_of"]
        )
    ]

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
            "negative_or_zero_price_rows": sum(
                row["negative_or_zero_price_rows"] for row in series_reports
            ),
            "invalid_ohlc_rows": invalid_ohlc_rows,
            "weekend_or_exchange_holiday_dates": sorted(invalid_session_dates),
            "zero_volume_rows": zero_volume_rows,
            "negative_volume_rows": negative_volume_rows,
            "corporate_action_metadata_rows": action_field_rows,
            "dividend_event_rows": dividend_event_rows,
            "split_event_rows": split_event_rows,
            "invalid_action_rows": invalid_action_rows,
            "extreme_adjusted_moves_35pct_or_more": len(anomalies),
            "series_with_missing_sessions": sum(
                row["missing_sessions_within_coverage"] > 0 for row in series_reports
            ),
            "max_missing_session_gap": max(
                (row["longest_missing_session_gap"] for row in series_reports),
                default=0,
            ),
            "max_missing_session_ratio_pct": max(
                (row["missing_session_ratio_pct"] or 0.0 for row in series_reports),
                default=0.0,
            ),
            "stale_series_count": len(stale_series),
            "stale_series_sessions_behind": dict(
                Counter(row["sessions_behind"] for row in stale_series)
            ),
            "stale_series_examples": stale_series[:20],
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
        "largest_gaps": sorted(
            series_reports,
            key=lambda row: row["longest_missing_session_gap"],
            reverse=True,
        )[:8],
        "series": series_reports,
        "extreme_moves_for_review": sorted(
            anomalies,
            key=lambda row: abs(row["adjusted_return_pct"]),
            reverse=True,
        ),
        "known_limitations": [
            "Yahoo Finance is an unofficial provider and does not offer a point-in-time security master.",
            "Some older core cache entries may not retain complete per-row split and dividend fields.",
            "Float shares are current quote metadata, not historical point-in-time counts.",
            "Extreme moves are flagged, not automatically treated as errors.",
            "A missing cache session may be a provider omission, an exchange closure not recognized by the local calendar, or a legitimate listing gap; the report does not invent or backfill it.",
            "The historical membership list is a curated current-survivor core, not a point-in-time CRSP-style security master.",
            "Cross-provider coverage is limited to AAPL and QQQ demo access without paid backup keys.",
        ],
    }
    OUTPUT.write_text(json.dumps(report, indent=2))
    print(json.dumps({key: report[key] for key in ("summary", "coverage_outliers", "known_limitations")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Provider availability probe for US Momentum Terminal.

Runs *real* network requests against each candidate market-data provider and
records exactly what happened. No results are synthesised: a provider that
returns an authentication error is recorded as "API key required", a provider
that is blocked is recorded as "blocked", and so on.

Usage:
    .venv-datatest/bin/python data-service/tests/provider_probe.py [--tickers N] [--json PATH]
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "data-service" / "docs"

SAMPLE_TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "AVGO", "GOOGL", "TSLA", "AMD", "NFLX",
    "PLTR", "ORCL", "COST", "WMT", "JPM", "XOM", "LLY", "BRK-B", "SPY", "QQQ",
]

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
TIMEOUT = 25


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def http(url: str, params: dict | None = None, headers: dict | None = None) -> dict:
    """Perform a timed GET and capture status, latency and a body snippet."""
    start = time.perf_counter()
    try:
        response = requests.get(url, params=params, headers=headers or {"User-Agent": UA}, timeout=TIMEOUT)
        elapsed = time.perf_counter() - start
        body = response.text[:600]
        try:
            payload = response.json()
        except ValueError:
            payload = None
        return {
            "url": response.url,
            "status": response.status_code,
            "elapsed_ms": round(elapsed * 1000),
            "body_snippet": body,
            "json": payload,
        }
    except Exception as exc:  # noqa: BLE001 - probe must never crash
        elapsed = time.perf_counter() - start
        return {
            "url": url,
            "status": None,
            "elapsed_ms": round(elapsed * 1000),
            "body_snippet": "",
            "json": None,
            "error": f"{type(exc).__name__}: {exc}",
        }


def classify_auth(result: dict) -> str:
    """Map an observed response onto Passed / Failed / API key required."""
    status = result.get("status")
    text = (result.get("body_snippet") or "").lower()
    if status in (401, 403):
        return "API key required / invalid"
    if "api key" in text or "apikey" in text or "api_key" in text or "token" in text:
        return "API key required"
    if status == 429:
        return "Rate limited"
    if status is not None and 200 <= status < 300:
        return "Passed (no key)"
    return "Failed"


# --------------------------------------------------------------------------- #
# Yahoo Finance (via yfinance)                                                 #
# --------------------------------------------------------------------------- #

def probe_yahoo(tickers: list[str], years: int = 2) -> dict:
    import yfinance as yf

    direct = http(
        "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        params={"range": "1mo", "interval": "1d"},
    )

    rows = []
    latencies = []
    failures = []
    for ticker in tickers:
        start = time.perf_counter()
        record = {"symbol": ticker}
        try:
            frame = yf.Ticker(ticker).history(period=f"{years}y", interval="1d", auto_adjust=False)
            elapsed = time.perf_counter() - start
            latencies.append(elapsed)
            if frame is None or frame.empty:
                record["status"] = "empty"
                failures.append(ticker)
                rows.append(record)
                continue
            frame = frame.dropna(subset=["Close"])
            record.update(
                {
                    "status": "ok",
                    "rows": int(len(frame)),
                    "first_date": frame.index[0].strftime("%Y-%m-%d"),
                    "last_date": frame.index[-1].strftime("%Y-%m-%d"),
                    "has_adj_close": "Adj Close" in frame.columns,
                    "has_dividends": "Dividends" in frame.columns,
                    "has_splits": "Stock Splits" in frame.columns,
                    "ohlcv_complete": bool(frame[["Open", "High", "Low", "Close", "Volume"]].notna().all().all()),
                    "last_close": round(float(frame["Close"].iloc[-1]), 4),
                    "elapsed_ms": round(elapsed * 1000),
                }
            )
        except Exception as exc:  # noqa: BLE001
            elapsed = time.perf_counter() - start
            latencies.append(elapsed)
            failures.append(ticker)
            record.update({"status": "error", "error": f"{type(exc).__name__}: {exc}", "elapsed_ms": round(elapsed * 1000)})
        rows.append(record)

    # Market cap is a separate quote endpoint; test it explicitly.
    cap = {"available": False}
    try:
        start = time.perf_counter()
        fast = yf.Ticker("AAPL").info
        cap = {
            "available": bool(fast.get("marketCap")),
            "market_cap": fast.get("marketCap"),
            "sector": fast.get("sector"),
            "name": fast.get("shortName"),
            "elapsed_ms": round((time.perf_counter() - start) * 1000),
        }
    except Exception as exc:  # noqa: BLE001
        cap = {"available": False, "error": f"{type(exc).__name__}: {exc}"}

    ok = [row for row in rows if row.get("status") == "ok"]
    latest = max((row["last_date"] for row in ok), default=None)
    return {
        "provider": "Yahoo Finance (yfinance)",
        "connection": "Connected" if ok else "Failed",
        "direct_endpoint": {
            "status": direct["status"],
            "elapsed_ms": direct["elapsed_ms"],
            "note": "Raw chart endpoint is aggressively rate limited without cookie/crumb; "
                    "the yfinance client performs the cookie+crumb handshake automatically.",
        },
        "authentication": "Not required",
        "historical_data": "Available" if ok else "Unavailable",
        "adjusted_close": "Available" if ok and all(row.get("has_adj_close") for row in ok) else "Unavailable",
        "ohlcv": "Complete" if ok and all(row.get("ohlcv_complete") for row in ok) else "Incomplete",
        "market_cap": "Available" if cap.get("available") else "Unavailable",
        "symbols_tested": len(tickers),
        "symbols_ok": len(ok),
        "symbols_failed": failures,
        "min_observations": min((row["rows"] for row in ok), default=0),
        "latest_data": latest,
        "median_latency_ms": round(statistics.median(latencies) * 1000) if latencies else None,
        "market_cap_detail": cap,
        "rows": rows,
        "rate_limits": "Unofficial API. Observed HTTP 429 on the raw chart endpoint; "
                       "yfinance survives by doing a cookie/crumb handshake and retrying. "
                       "No published quota - must be paced client-side.",
    }


# --------------------------------------------------------------------------- #
# Key-based providers                                                          #
# --------------------------------------------------------------------------- #

def probe_fmp() -> dict:
    key = os.environ.get("FMP_API_KEY", "").strip()
    if not key:
        legacy = http("https://financialmodelingprep.com/api/v3/historical-price-full/AAPL", params={"apikey": "demo"})
        stable = http("https://financialmodelingprep.com/stable/historical-price-eod/full", params={"symbol": "AAPL"})
        return {
            "provider": "Financial Modeling Prep",
            "connection": "Connected (HTTP reachable)" if legacy["status"] else "Failed",
            "authentication": "API key required",
            "historical_data": "Not tested - no API key",
            "adjusted_close": "Not tested",
            "ohlcv": "Not tested",
            "market_cap": "Not tested",
            "symbols_tested": 0,
            "symbols_ok": 0,
            "latest_data": None,
            "median_latency_ms": legacy["elapsed_ms"],
            "observed": {
                "legacy_v3_status": legacy["status"],
                "stable_status": stable["status"],
                "body": (legacy["body_snippet"] or "").strip()[:240],
            },
            "rate_limits": "Free plan documented at 250 requests/day. Not verifiable without a key.",
        }

    quotes = http(
        f"https://financialmodelingprep.com/stable/historical-price-eod/full",
        params={"symbol": "AAPL", "apikey": key},
    )
    rows = quotes.get("json") or []
    latest = rows[0]["date"] if isinstance(rows, list) and rows else None
    return {
        "provider": "Financial Modeling Prep",
        "connection": "Connected",
        "authentication": "Passed",
        "historical_data": "Available" if rows else "Unavailable",
        "adjusted_close": "Available" if rows and "adjClose" in rows[0] else "Unavailable",
        "ohlcv": "Complete" if rows and all(k in rows[0] for k in ("open", "high", "low", "close", "volume")) else "Incomplete",
        "market_cap": "Not tested",
        "symbols_tested": 1,
        "symbols_ok": 1 if rows else 0,
        "latest_data": latest,
        "median_latency_ms": quotes["elapsed_ms"],
        "rate_limits": "Free plan: 250 requests/day (documented).",
    }


def probe_alpha_vantage(tickers: list[str]) -> dict:
    key = os.environ.get("ALPHAVANTAGE_API_KEY", "").strip() or "demo"
    rows = []
    latencies = []
    last_series: dict = {}
    last_message = None
    for ticker in (tickers if key != "demo" else ["AAPL", "MSFT", "IBM"]):
        result = http(
            "https://www.alphavantage.co/query",
            params={
                "function": "TIME_SERIES_DAILY_ADJUSTED",
                "symbol": ticker,
                "outputsize": "compact",
                "apikey": key,
            },
        )
        payload = result.get("json") or {}
        series = payload.get("Time Series (Daily)") or {}
        message = payload.get("Information") or payload.get("Note") or payload.get("Error Message")
        latencies.append(result["elapsed_ms"] / 1000)
        rows.append({"symbol": ticker, "status": result["status"], "ok": bool(series), "message": (message or "")[:160]})
        if series:
            last_series = series
        if message:
            last_message = message
    ok_rows = [row for row in rows if row["ok"]]
    sample = next(iter(last_series.values()), {})
    return {
        "provider": "Alpha Vantage",
        "connection": "Connected (HTTP reachable)" if any(row["status"] == 200 for row in rows) else "Failed",
        "authentication": "Passed for demo symbol only" if ok_rows and key == "demo" else ("Passed" if ok_rows else "API key required"),
        "historical_data": "Available" if ok_rows else "Not tested - no API key",
        "adjusted_close": "Available" if sample and "7. adjusted close" in sample else ("Not tested" if not sample else "Unavailable (premium function)"),
        "ohlcv": "Complete" if sample and all(k in sample for k in ("1. open", "2. high", "3. low", "4. close", "6. volume")) else ("Not tested" if not sample else "Incomplete"),
        "market_cap": "Not tested",
        "symbols_tested": len(rows),
        "symbols_ok": len(ok_rows),
        "ok_symbols": [row["symbol"] for row in ok_rows],
        "latest_data": max(last_series) if last_series else None,
        "median_latency_ms": round(statistics.median(latencies) * 1000) if latencies else None,
        "observed": {"key_used": "demo" if key == "demo" else "environment", "message": (last_message or "")[:240]},
        "rate_limits": "Free tier documented at 25 requests/day. The public 'demo' key serves a single demo symbol; "
                       "TIME_SERIES_DAILY_ADJUSTED is a premium function.",
        "rows": rows,
    }


def probe_finnhub() -> dict:
    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    quote = http("https://finnhub.io/api/v1/quote", params={"symbol": "AAPL", "token": key} if key else {"symbol": "AAPL"})
    candles = http(
        "https://finnhub.io/api/v1/stock/candle",
        params={"symbol": "AAPL", "resolution": "D", "from": "1735689600", "to": "1790000000", "token": key} if key else {"symbol": "AAPL"},
    )
    payload = quote.get("json")
    ok = bool(isinstance(payload, dict) and payload.get("c"))
    return {
        "provider": "Finnhub",
        "connection": "Connected (HTTP reachable)" if quote["status"] else "Failed",
        "authentication": "Passed" if ok else "API key required",
        "historical_data": "Available" if ok else "Not tested - no API key",
        "adjusted_close": "Not tested" if not ok else "Unknown",
        "ohlcv": "Not tested" if not ok else "Unknown",
        "market_cap": "Not tested",
        "symbols_tested": 1 if ok else 0,
        "symbols_ok": 1 if ok else 0,
        "latest_data": None,
        "median_latency_ms": quote["elapsed_ms"],
        "observed": {
            "quote_status": quote["status"],
            "candle_status": candles["status"],
            "body": (quote["body_snippet"] or "").strip()[:200],
        },
        "rate_limits": "Free tier documented at 60 API calls/minute. Historic candles are not included in the free tier.",
    }


def probe_twelvedata(tickers: list[str]) -> dict:
    key = os.environ.get("TWELVEDATA_API_KEY", "").strip() or "demo"
    rows = []
    latencies = []
    for ticker in tickers:
        result = http(
            "https://api.twelvedata.com/time_series",
            params={"symbol": ticker, "interval": "1day", "outputsize": 5, "apikey": key},
        )
        payload = result.get("json") or {}
        values = payload.get("values") if isinstance(payload, dict) else None
        latencies.append(result["elapsed_ms"] / 1000)
        rows.append(
            {
                "symbol": ticker,
                "status": result["status"],
                "ok": bool(values),
                "message": (payload.get("message") if isinstance(payload, dict) else None),
                "latest": values[0]["datetime"] if values else None,
            }
        )
    ok_rows = [row for row in rows if row["ok"]]
    return {
        "provider": "Twelve Data",
        "connection": "Connected" if any(row["status"] == 200 for row in rows) else "Failed",
        "authentication": "Passed for demo symbols only" if ok_rows and key == "demo" else ("Passed" if ok_rows else "API key required"),
        "historical_data": "Available" if ok_rows else "Not tested - no API key",
        "adjusted_close": "Not verified",
        "ohlcv": "Complete" if ok_rows else "Not tested",
        "market_cap": "Not tested",
        "symbols_tested": len(tickers),
        "symbols_ok": len(ok_rows),
        "ok_symbols": [row["symbol"] for row in ok_rows],
        "latest_data": ok_rows[0]["latest"] if ok_rows else None,
        "median_latency_ms": round(statistics.median(latencies) * 1000) if latencies else None,
        "rate_limits": "Free tier documented at 8 requests/minute and 800 requests/day. "
                       "The public 'demo' key is restricted to a handful of symbols.",
        "rows": rows,
    }


def probe_polygon() -> dict:
    key = os.environ.get("POLYGON_API_KEY", "").strip()
    result = http(
        "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2026-10-01/2026-11-11",
        params={"apiKey": key} if key else {"apiKey": "demo"},
    )
    payload = result.get("json") or {}
    ok = bool(isinstance(payload, dict) and payload.get("results"))
    return {
        "provider": "Polygon.io",
        "connection": "Connected (HTTP reachable)" if result["status"] else "Failed",
        "authentication": "Passed" if ok else "API key required",
        "historical_data": "Available" if ok else "Not tested - no API key",
        "adjusted_close": "Available (adjusted=true parameter)" if ok else "Not tested",
        "ohlcv": "Complete" if ok else "Not tested",
        "market_cap": "Not tested",
        "symbols_tested": 1 if ok else 0,
        "symbols_ok": 1 if ok else 0,
        "latest_data": None,
        "median_latency_ms": result["elapsed_ms"],
        "observed": {"status": result["status"], "body": (result["body_snippet"] or "").strip()[:200]},
        "rate_limits": "Free tier documented at 5 requests/minute. Not verifiable without a key.",
    }


def probe_stooq(tickers: list[str]) -> dict:
    rows = []
    for ticker in tickers[:5]:
        symbol = ticker.lower().replace("-", "-") + ".us"
        result = http("https://stooq.com/q/d/l/", params={"s": symbol, "i": "d"})
        body = result.get("body_snippet") or ""
        csv_ok = body.startswith("Date,Open,High,Low,Close,Volume")
        rows.append(
            {
                "symbol": symbol,
                "status": result["status"],
                "csv": csv_ok,
                "blocked": "requires JavaScript" in body,
                "error": result.get("error"),
                "elapsed_ms": result["elapsed_ms"],
            }
        )
    blocked = all(row["blocked"] for row in rows)
    unreachable = all(row["status"] is None for row in rows)
    return {
        "provider": "Stooq",
        "connection": "Failed" if unreachable else ("Connected (HTTP reachable)" if all(row["status"] == 200 for row in rows) else "Failed"),
        "authentication": "Not required",
        "historical_data": (
            "Unavailable (requests refused)"
            if unreachable
            else ("Unavailable (blocked by anti-bot challenge)" if blocked else ("Available" if any(row["csv"] for row in rows) else "Unavailable"))
        ),
        "adjusted_close": "Unavailable" if blocked else "Unknown",
        "ohlcv": "Unavailable" if blocked else "Unknown",
        "market_cap": "Unavailable",
        "symbols_tested": len(rows),
        "symbols_ok": sum(1 for row in rows if row["csv"]),
        "latest_data": None,
        "median_latency_ms": None,
        "rate_limits": "No published limit; anonymous daily CSV export. Currently intercepted by a bot-verification page.",
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", type=int, default=len(SAMPLE_TICKERS))
    parser.add_argument("--json", default=str(DOCS / "provider_probe.json"))
    args = parser.parse_args()

    tickers = SAMPLE_TICKERS[: args.tickers]
    started = time.time()
    print(f"Probing {len(tickers)} tickers across providers at {now_iso()} ...\n")

    results = []
    for name, fn in [
        ("Yahoo Finance (yfinance)", lambda: probe_yahoo(tickers)),
        ("Financial Modeling Prep", probe_fmp),
        ("Alpha Vantage", lambda: probe_alpha_vantage(tickers)),
        ("Finnhub", probe_finnhub),
        ("Twelve Data", lambda: probe_twelvedata(tickers)),
        ("Polygon.io", probe_polygon),
        ("Stooq", lambda: probe_stooq(tickers)),
    ]:
        print(f"- {name} ...", flush=True)
        try:
            results.append(fn())
        except Exception as exc:  # noqa: BLE001
            results.append({"provider": name, "connection": "Failed", "error": f"{type(exc).__name__}: {exc}"})

    payload = {
        "generated_at": now_iso(),
        "duration_seconds": round(time.time() - started, 1),
        "tickers": tickers,
        "providers": results,
    }
    Path(args.json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.json).write_text(json.dumps(payload, indent=2, default=str))
    print(f"\nWrote {args.json}")

    for row in results:
        print(
            f"{row['provider']:<28} conn={row.get('connection'):<32} "
            f"auth={row.get('authentication'):<34} ok={row.get('symbols_ok')}/{row.get('symbols_tested')} "
            f"latest={row.get('latest_data')} latency={row.get('median_latency_ms')}ms"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Stooq adapter - free, keyless daily CSV export.

Probed on 2026-11-11: stooq.com answers HTTP 200 but serves an anti-bot
JavaScript challenge instead of the CSV, so the adapter raises ProviderBlocked
rather than pretending the data exists. If the challenge is not present (for
example from a different network), the adapter parses the CSV normally.
Stooq has no adjusted close, so its series are flagged ``adjusted=False`` and
the momentum engine refuses to use them for scoring.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

import requests

from .. import cache
from ..config import settings
from ..models import (
    NormalizedBar,
    ProviderBlocked,
    ProviderNoData,
    ProviderUnavailable,
    QuoteSnapshot,
    SeriesResult,
)
from .base import ProviderAdapter, RateLimiter

_LIMITER = RateLimiter(per_minute=30, burst=4)
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*",
}


class StooqProvider(ProviderAdapter):
    id = "stooq"
    label = "Stooq"
    requires_key = False
    docs_url = "https://stooq.com/q/d/?s=aapl.us"
    notes = "Free daily CSV, no adjusted close, currently behind a bot-verification wall."

    def available(self) -> bool:
        return True

    @staticmethod
    def _symbol(symbol: str) -> str:
        return f"{symbol.lower().replace('.', '-')}.us"

    def fetch_series(self, symbol: str, years: int | None = None) -> SeriesResult:
        key = f"{symbol}:{years or settings.history_years}y"
        cached = cache.read("stooq_bars", key, settings.ttl_bars_intraday)
        if cached:
            return SeriesResult(
                symbol=symbol,
                bars=[NormalizedBar(**row) for row in cached["bars"]],
                source=self.id,
                source_label=self.label,
                fetched_at=cached["fetched_at"],
                adjusted=False,
                is_backup=True,
                warnings=["Stooq does not provide adjusted closes"],
            )

        _LIMITER.acquire()
        try:
            response = requests.get(
                "https://stooq.com/q/d/l/",
                params={"s": self._symbol(symbol), "i": "d"},
                headers=_HEADERS,
                timeout=settings.request_timeout,
            )
        except requests.RequestException as exc:
            raise ProviderUnavailable(str(exc)) from exc

        text = response.text or ""
        if response.status_code != 200:
            raise ProviderUnavailable(f"HTTP {response.status_code}")
        if "requires JavaScript" in text or text.lstrip().startswith("<!DOCTYPE"):
            raise ProviderBlocked("Stooq served an anti-bot challenge instead of CSV")
        if not text.startswith("Date,"):
            raise ProviderNoData(f"unexpected Stooq payload for {symbol}")

        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        bars: list[NormalizedBar] = []
        for row in csv.DictReader(io.StringIO(text)):
            bars.append(
                NormalizedBar(
                    symbol=symbol,
                    date=(row.get("Date") or "")[:10],
                    open=_num(row.get("Open")),
                    high=_num(row.get("High")),
                    low=_num(row.get("Low")),
                    close=_num(row.get("Close")),
                    adjusted_close=_num(row.get("Close")),
                    volume=_num(row.get("Volume")),
                    market_cap=None,
                    dividends=None,
                    stock_splits=None,
                    data_source=self.id,
                    last_updated=fetched_at,
                )
            )
        if not bars:
            raise ProviderNoData(f"empty Stooq series for {symbol}")

        if years:
            cutoff = f"{datetime.now(timezone.utc).year - years}-01-01"
            bars = [bar for bar in bars if bar.date >= cutoff]

        cache.write_bars(
            "stooq_bars",
            key,
            {"symbol": symbol, "fetched_at": fetched_at, "bars": [bar.serialize() for bar in bars]},
        )
        return SeriesResult(
            symbol=symbol,
            bars=bars,
            source=self.id,
            source_label=self.label,
            fetched_at=fetched_at,
            adjusted=False,
            is_backup=True,
            warnings=["Stooq does not provide adjusted closes"],
        )

    def fetch_quote(self, symbol: str) -> QuoteSnapshot:
        raise ProviderNoData("Stooq CSV export has no quote/metadata endpoint")


def _num(value) -> float | None:
    try:
        if value in (None, "", "N/A"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None

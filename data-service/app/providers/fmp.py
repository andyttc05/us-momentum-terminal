"""Financial Modeling Prep adapter (API key required).

Probed on 2026-11-11: both the legacy ``/api/v3`` and current ``/stable``
endpoints answer HTTP 401 "Invalid API KEY" without a key, so the adapter stays
dormant until ``FMP_API_KEY`` is configured. Free plan is documented at
250 requests/day, which is why the adapter is limited to 2 requests/minute and
leans on the disk cache.
"""

from __future__ import annotations

from datetime import datetime, timezone

import requests

from .. import cache
from ..config import settings
from ..models import (
    NormalizedBar,
    ProviderAuthError,
    ProviderNoData,
    ProviderRateLimited,
    ProviderUnavailable,
    QuoteSnapshot,
    SeriesResult,
)
from .base import ProviderAdapter, RateLimiter

_LIMITER = RateLimiter(per_minute=4, burst=1)
_BASE = "https://financialmodelingprep.com/stable"


class FmpProvider(ProviderAdapter):
    id = "fmp"
    label = "Financial Modeling Prep"
    requires_key = True
    docs_url = "https://site.financialmodelingprep.com/developer/docs"
    notes = "Free plan: 250 requests/day. Adjusted EOD prices available."

    def available(self) -> bool:
        return bool(settings.fmp_api_key)

    def _get(self, path: str, params: dict):
        params = {**params, "apikey": settings.fmp_api_key}
        _LIMITER.acquire()
        try:
            response = requests.get(f"{_BASE}/{path}", params=params, timeout=settings.request_timeout)
        except requests.RequestException as exc:
            raise ProviderUnavailable(str(exc)) from exc
        if response.status_code == 429:
            raise ProviderRateLimited("FMP daily quota reached")
        if response.status_code in (401, 403):
            raise ProviderAuthError("FMP rejected the API key")
        if response.status_code >= 400:
            raise ProviderUnavailable(f"FMP HTTP {response.status_code}")
        return response.json()

    def fetch_series(self, symbol: str, years: int | None = None) -> SeriesResult:
        if not self.available():
            raise ProviderAuthError("FMP_API_KEY is not configured")
        years = years or settings.history_years
        cached = cache.read("fmp_bars", f"{symbol}:{years}y", settings.ttl_bars_intraday)
        if cached:
            return SeriesResult(
                symbol=symbol,
                bars=[NormalizedBar(**row) for row in cached["bars"]],
                source=self.id,
                source_label=self.label,
                fetched_at=cached["fetched_at"],
                adjusted=cached["adjusted"],
                is_backup=True,
            )

        start = datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year - years).strftime("%Y-%m-%d")
        payload = self._get("historical-price-eod/full", {"symbol": symbol, "from": start})
        rows = payload if isinstance(payload, list) else payload.get("historical", [])
        if not rows:
            raise ProviderNoData(f"FMP returned no rows for {symbol}")

        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        adjusted = all(_num(row.get("adjClose")) is not None for row in rows)
        bars = [
            NormalizedBar(
                symbol=symbol,
                date=str(row.get("date"))[:10],
                open=_num(row.get("open")),
                high=_num(row.get("high")),
                low=_num(row.get("low")),
                close=_num(row.get("close")),
                adjusted_close=_num(row.get("adjClose")),
                volume=_num(row.get("volume")),
                market_cap=None,
                dividends=_num(row.get("dividend")),
                stock_splits=_num(row.get("splitRatio")),
                data_source=self.id,
                last_updated=fetched_at,
            )
            for row in rows
        ]
        bars.sort(key=lambda bar: bar.date)
        cache.write_bars(
            "fmp_bars",
            f"{symbol}:{years}y",
            {"symbol": symbol, "fetched_at": fetched_at, "adjusted": adjusted, "bars": [b.serialize() for b in bars]},
        )
        return SeriesResult(
            symbol=symbol,
            bars=bars,
            source=self.id,
            source_label=self.label,
            fetched_at=fetched_at,
            adjusted=adjusted,
            is_backup=True,
        )

    def fetch_quote(self, symbol: str) -> QuoteSnapshot:
        if not self.available():
            raise ProviderAuthError("FMP_API_KEY is not configured")
        payload = self._get("quote", {"symbol": symbol})
        if not payload:
            raise ProviderNoData(f"FMP has no quote for {symbol}")
        row = payload[0]
        quote_type = "ADR" if row.get("isAdr") else ("ETF" if row.get("isEtf") else "EQUITY")
        return QuoteSnapshot(
            symbol=symbol,
            name=row.get("name"),
            sector=None,
            exchange=row.get("exchange"),
            market_cap=_num(row.get("marketCap")),
            currency="USD",
            source=self.id,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            quote_type=quote_type,
            shares_outstanding=_num(row.get("sharesOutstanding")),
            float_shares=_num(row.get("floatShares")),
            average_daily_volume_3m=_num(row.get("averageVolume")),
            regular_market_price=_num(row.get("price")),
        )


def _num(value) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None

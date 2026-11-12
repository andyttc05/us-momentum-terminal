"""Twelve Data adapter (REST, API key required for real coverage).

Probed on 2026-11-11: HTTP 200 with the documented ``demo`` key only for the
handful of demo symbols (AAPL, QQQ); every other ticker returns HTTP 401.
With a free key the plan allows 8 requests/minute and 800/day, so the adapter
is rate limited accordingly and relies on the disk cache.
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

_LIMITER = RateLimiter(per_minute=8, burst=2)
_BASE = "https://api.twelvedata.com"


class TwelveDataProvider(ProviderAdapter):
    id = "twelvedata"
    label = "Twelve Data"
    requires_key = True
    docs_url = "https://twelvedata.com/docs"
    notes = "Free plan: 8 requests/min, 800/day. Adjusted close needs a paid plan."

    def available(self) -> bool:
        return bool(settings.twelve_data_api_key)

    def _call(self, path: str, params: dict) -> dict:
        params = {**params, "apikey": settings.twelve_data_api_key}
        _LIMITER.acquire()
        try:
            response = requests.get(f"{_BASE}/{path}", params=params, timeout=settings.request_timeout)
        except requests.RequestException as exc:
            raise ProviderUnavailable(str(exc)) from exc

        if response.status_code == 429:
            raise ProviderRateLimited("Twelve Data rate limit reached")
        if response.status_code in (401, 403):
            raise ProviderAuthError("Twelve Data rejected the API key")
        if response.status_code >= 500:
            raise ProviderUnavailable(f"Twelve Data HTTP {response.status_code}")

        payload = response.json(content_type=None)
        if isinstance(payload, dict) and payload.get("status") == "error":
            code = payload.get("code")
            message = payload.get("message", "unknown error")
            if code == 429:
                raise ProviderRateLimited(message)
            if code in (401, 403):
                raise ProviderAuthError(message)
            raise ProviderNoData(message)
        return payload

    def fetch_series(self, symbol: str, years: int | None = None) -> SeriesResult:
        if not self.available():
            raise ProviderAuthError("TWELVEDATA_API_KEY is not configured")

        years = years or settings.history_years
        cached = cache.read("twelvedata_bars", f"{symbol}:{years}y", settings.ttl_bars_intraday)
        if cached:
            return SeriesResult(
                symbol=symbol,
                bars=[NormalizedBar(**row) for row in cached["bars"]],
                source=self.id,
                source_label=self.label,
                fetched_at=cached["fetched_at"],
                adjusted=cached["adjusted"],
                is_backup=True,
                warnings=cached.get("warnings", []),
            )

        payload = self._call(
            "time_series",
            {"symbol": symbol, "interval": "1day", "outputsize": min(5000, years * 260 + 40), "order": "ASC"},
        )
        values = payload.get("values") or []
        if not values:
            raise ProviderNoData(f"Twelve Data returned no values for {symbol}")

        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        adjusted = all(_num(row.get("adj_close")) is not None for row in values)
        bars = [
            NormalizedBar(
                symbol=symbol,
                date=row["datetime"][:10],
                open=_num(row.get("open")),
                high=_num(row.get("high")),
                low=_num(row.get("low")),
                close=_num(row.get("close")),
                adjusted_close=_num(row.get("adj_close")),
                volume=_num(row.get("volume")),
                market_cap=None,
                dividends=None,
                stock_splits=None,
                data_source=self.id,
                last_updated=fetched_at,
            )
            for row in values
        ]
        warnings = [] if adjusted else ["provider did not return adjusted closes"]
        cache.write_bars(
            "twelvedata_bars",
            f"{symbol}:{years}y",
            {"symbol": symbol, "fetched_at": fetched_at, "adjusted": adjusted, "bars": [b.serialize() for b in bars], "warnings": warnings},
        )
        return SeriesResult(
            symbol=symbol,
            bars=bars,
            source=self.id,
            source_label=self.label,
            fetched_at=fetched_at,
            adjusted=adjusted,
            is_backup=True,
            warnings=warnings,
        )

    def fetch_quote(self, symbol: str) -> QuoteSnapshot:
        if not self.available():
            raise ProviderAuthError("TWELVEDATA_API_KEY is not configured")
        payload = self._call("quote", {"symbol": symbol})
        if not payload.get("symbol"):
            raise ProviderNoData(f"Twelve Data has no quote for {symbol}")
        return QuoteSnapshot(
            symbol=symbol,
            name=payload.get("name"),
            sector=None,
            exchange=payload.get("exchange"),
            market_cap=_num(payload.get("market_cap")),
            currency=payload.get("currency"),
            source=self.id,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            quote_type=payload.get("type") or payload.get("instrument_type"),
            shares_outstanding=_num(payload.get("shares_outstanding")),
            float_shares=_num(payload.get("float_shares")),
            average_daily_volume_3m=_num(payload.get("average_volume")),
            regular_market_price=_num(payload.get("close")),
        )


def _num(value) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None

"""Normalized market-data schema shared by every provider adapter.

This module is the contract that keeps providers interchangeable: adapters only
have to translate their wire format into ``NormalizedBar`` / ``QuoteSnapshot``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class NormalizedBar:
    """One daily observation, normalized across providers."""

    symbol: str
    date: str                 # YYYY-MM-DD
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    adjusted_close: float | None
    volume: float | None
    market_cap: float | None
    dividends: float | None
    stock_splits: float | None
    data_source: str
    last_updated: str         # ISO-8601 UTC, when this row was fetched

    def serialize(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SeriesResult:
    """A provider's answer for one symbol."""

    symbol: str
    bars: list[NormalizedBar]
    source: str
    source_label: str
    fetched_at: str
    adjusted: bool
    is_backup: bool = False
    cached: bool = False
    cache_age_seconds: float | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def latest_date(self) -> str | None:
        return self.bars[-1].date if self.bars else None


@dataclass
class QuoteSnapshot:
    symbol: str
    name: str | None = None
    sector: str | None = None
    exchange: str | None = None
    market_cap: float | None = None
    currency: str | None = None
    source: str = ""
    fetched_at: str = ""
    quote_type: str | None = None
    shares_outstanding: float | None = None
    float_shares: float | None = None
    average_daily_volume_3m: float | None = None
    regular_market_price: float | None = None
    detail_level: str = "full"
    cached: bool = False
    cache_age_seconds: float | None = None


class ProviderError(RuntimeError):
    """Base error for provider failures."""


class ProviderUnavailable(ProviderError):
    """Network/timeout/malformed payload - the provider could not answer."""


class ProviderAuthError(ProviderError):
    """The provider rejected our credentials (or none were supplied)."""


class ProviderRateLimited(ProviderError):
    """The provider asked us to slow down."""


class ProviderBlocked(ProviderError):
    """The provider served an anti-bot challenge instead of data."""


class ProviderNoData(ProviderError):
    """The provider answered correctly but has no data for this symbol."""


def validate_bars(bars: list[NormalizedBar], *, min_rows: int = 1) -> tuple[list[NormalizedBar], list[str]]:
    """Clean a series: drop impossible rows, de-duplicate dates, sort ascending.

    Returns the cleaned series and a list of human-readable warnings. Rows are
    never silently invented - anything dropped is reported.
    """
    warnings: list[str] = []
    by_date: dict[str, NormalizedBar] = {}
    dropped_price = 0
    duplicate_dates = 0

    for bar in bars:
        if not bar.date or len(bar.date) != 10:
            continue
        if bar.close is None or bar.close <= 0:
            dropped_price += 1
            continue
        if bar.high is not None and bar.low is not None and bar.high < bar.low:
            dropped_price += 1
            continue
        if bar.date in by_date:
            duplicate_dates += 1
            # Keep the most recently fetched row for the date.
            if bar.last_updated >= by_date[bar.date].last_updated:
                by_date[bar.date] = bar
            continue
        by_date[bar.date] = bar

    cleaned = [by_date[key] for key in sorted(by_date)]
    if dropped_price:
        warnings.append(f"dropped {dropped_price} row(s) with invalid prices")
    if duplicate_dates:
        warnings.append(f"collapsed {duplicate_dates} duplicate date(s)")
    if len(cleaned) < min_rows:
        warnings.append(f"only {len(cleaned)} valid row(s) available")
    return cleaned, warnings

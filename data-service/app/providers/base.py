"""Provider adapter contract + shared helpers (rate limiting, retries)."""

from __future__ import annotations

import threading
import time
from abc import ABC, abstractmethod
from typing import Iterable

from ..config import settings
from ..models import QuoteSnapshot, SeriesResult


class RateLimiter:
    """Thread-safe token bucket so we never trip a provider's published quota."""

    def __init__(self, per_minute: int, burst: int | None = None) -> None:
        self.capacity = max(1, burst or per_minute)
        self.rate = max(0.001, per_minute / 60.0)
        self._tokens = float(self.capacity)
        self._updated = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self, tokens: int = 1) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
                self._updated = now
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return
                wait = (tokens - self._tokens) / self.rate
            time.sleep(min(wait, 5.0))


class ProviderAdapter(ABC):
    """Every adapter exposes the same two capabilities."""

    id: str
    label: str
    requires_key: bool = False
    docs_url: str = ""
    notes: str = ""

    @abstractmethod
    def available(self) -> bool:
        """True when this adapter can be used in the current process."""

    @abstractmethod
    def fetch_series(self, symbol: str, years: int | None = None) -> SeriesResult:
        """Daily OHLCV + adjusted close + corporate actions for one symbol."""

    @abstractmethod
    def fetch_quote(self, symbol: str) -> QuoteSnapshot:
        """Name, sector, exchange and market cap for one symbol."""

    def fetch_many(self, symbols: Iterable[str], years: int | None = None) -> dict[str, SeriesResult]:
        """Default: sequential fetch. Adapters may override with a batch call."""
        out: dict[str, SeriesResult] = {}
        for symbol in symbols:
            out[symbol] = self.fetch_series(symbol, years)
        return out

    def status(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "available": self.available(),
            "requires_key": self.requires_key,
            "docs_url": self.docs_url,
            "notes": self.notes,
        }


def timeout_seconds() -> int:
    return settings.request_timeout

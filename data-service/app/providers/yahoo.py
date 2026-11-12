"""Yahoo Finance adapter.

Uses the ``yfinance`` client, which performs the cookie + crumb handshake that
Yahoo's raw chart endpoint requires (the raw endpoint answers HTTP 429 without
it - verified during the provider probe). Yahoo is the only provider in this
project's probe that returned adjusted closes, market caps, splits and
dividends for every sample ticker without an API key.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

import pandas as pd

from .. import cache
from ..config import settings
from ..models import (
    NormalizedBar,
    ProviderError,
    ProviderNoData,
    ProviderRateLimited,
    ProviderUnavailable,
    QuoteSnapshot,
    SeriesResult,
)
from .base import ProviderAdapter, RateLimiter

logging.getLogger("yfinance").setLevel(logging.CRITICAL)

_LIMITER = RateLimiter(per_minute=120, burst=16)
_BATCH_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _import_yfinance():
    try:
        import yfinance as yf  # noqa: PLC0415 - optional heavy import
    except ImportError as exc:  # pragma: no cover
        raise ProviderUnavailable("yfinance is not installed") from exc
    return yf


def cache_ttl() -> int:
    """Bars go stale quickly while the market is open, slowly once it is closed."""
    from ..clock import market_state  # local import avoids a cycle

    return settings.ttl_bars_intraday if market_state()["is_open"] else settings.ttl_bars_closed


class _BatchMixin:
    """Yahoo can answer for many tickers in one HTTP round-trip."""

    def fetch_many(self, symbols, years: int | None = None):
        symbols = list(symbols)
        ttl = cache_ttl()
        out: dict[str, SeriesResult] = {}
        pending: list[str] = []

        for symbol in symbols:
            cached = cache.read("yahoo_bars", f"{symbol}:{years or settings.history_years}y", ttl)
            if cached:
                out[symbol] = SeriesResult(
                    symbol=cached["symbol"],
                    bars=[NormalizedBar(**row) for row in cached["bars"]],
                    source=self.id,
                    source_label=self.label,
                    fetched_at=cached["fetched_at"],
                    adjusted=cached["adjusted"],
                    warnings=cached.get("warnings", []),
                )
            else:
                pending.append(symbol)

        if not pending:
            return out

        yf = _import_yfinance()
        years = years or settings.history_years
        _LIMITER.acquire(max(1, min(len(pending), 8)))
        try:
            frame = yf.download(
                pending,
                period=f"{years}y",
                interval="1d",
                auto_adjust=False,
                actions=True,
                group_by="ticker",
                threads=True,
                progress=False,
            )
        except Exception as exc:  # noqa: BLE001
            frame = None
            batch_error = exc
        else:
            batch_error = None

        for symbol in pending:
            series_frame = None
            if frame is not None and not frame.empty:
                try:
                    series_frame = frame[symbol] if isinstance(frame.columns, pd.MultiIndex) else frame
                except KeyError:
                    series_frame = None
            if series_frame is None or series_frame.dropna(subset=["Close"]).empty:
                try:
                    out[symbol] = self.fetch_series(symbol, years)
                except ProviderError:
                    continue
                continue

            fetched_at = _now()
            bars = []
            adjusted = (
                "Adj Close" in series_frame.columns
                and series_frame["Adj Close"].notna().all()
            )
            for index, row in series_frame.dropna(subset=["Close"]).iterrows():
                bars.append(
                    NormalizedBar(
                        symbol=symbol,
                        date=index.strftime("%Y-%m-%d"),
                        open=_num(row.get("Open")),
                        high=_num(row.get("High")),
                        low=_num(row.get("Low")),
                        close=_num(row.get("Close")),
                        adjusted_close=_num(row.get("Adj Close")),
                        volume=_num(row.get("Volume")),
                        market_cap=None,
                        dividends=_num(row.get("Dividends")),
                        stock_splits=_num(row.get("Stock Splits")),
                        data_source=self.id,
                        last_updated=fetched_at,
                    )
                )
            if not bars:
                continue
            cache.write_bars(
                "yahoo_bars",
                f"{symbol}:{years}y",
                {
                    "symbol": symbol,
                    "fetched_at": fetched_at,
                    "adjusted": adjusted,
                    "corporate_actions_complete": True,
                    "bars": [bar.serialize() for bar in bars],
                },
            )
            out[symbol] = SeriesResult(
                symbol=symbol,
                bars=bars,
                source=self.id,
                source_label=self.label,
                fetched_at=fetched_at,
                adjusted=adjusted,
                warnings=[] if adjusted else ["provider did not return adjusted closes"],
            )
        return out


class YahooProvider(_BatchMixin, ProviderAdapter):
    id = "yahoo"
    label = "Yahoo Finance"
    requires_key = False
    docs_url = "https://github.com/ranaroussi/yfinance"
    notes = "Unofficial API via yfinance. Cookie/crumb handshake required; paced client-side."

    def available(self) -> bool:
        try:
            _import_yfinance()
            return True
        except ProviderUnavailable:
            return False

    # ------------------------------------------------------------------ series
    def fetch_series(self, symbol: str, years: int | None = None) -> SeriesResult:
        years = years or settings.history_years
        key = f"{symbol}:{years}y"
        ttl = cache_ttl()
        cached = cache.read("yahoo_bars", key, ttl)
        if cached:
            return SeriesResult(
                symbol=cached["symbol"],
                bars=[NormalizedBar(**row) for row in cached["bars"]],
                source=self.id,
                source_label=self.label,
                fetched_at=cached["fetched_at"],
                adjusted=cached["adjusted"],
                warnings=cached.get("warnings", []),
            )

        yf = _import_yfinance()
        _LIMITER.acquire()
        try:
            frame = yf.Ticker(symbol).history(period=f"{years}y", interval="1d", auto_adjust=False)
        except Exception as exc:  # noqa: BLE001 - normalize every client failure
            message = str(exc)
            if "429" in message or "Too Many Requests" in message:
                raise ProviderRateLimited(message) from exc
            raise ProviderUnavailable(message) from exc

        if frame is None or frame.empty:
            raise ProviderNoData(f"no rows returned for {symbol}")

        fetched_at = _now()
        bars: list[NormalizedBar] = []
        adjusted = "Adj Close" in frame.columns and frame["Adj Close"].notna().all()
        for index, row in frame.iterrows():
            try:
                date = index.strftime("%Y-%m-%d")
            except AttributeError:
                date = str(index)[:10]
            bars.append(
                NormalizedBar(
                    symbol=symbol,
                    date=date,
                    open=_num(row.get("Open")),
                    high=_num(row.get("High")),
                    low=_num(row.get("Low")),
                    close=_num(row.get("Close")),
                    adjusted_close=_num(row.get("Adj Close")),
                    volume=_num(row.get("Volume")),
                    market_cap=None,
                    dividends=_num(row.get("Dividends")),
                    stock_splits=_num(row.get("Stock Splits")),
                    data_source=self.id,
                    last_updated=fetched_at,
                )
            )

        if not bars:
            raise ProviderNoData(f"no usable bars for {symbol}")

        payload = {
            "symbol": symbol,
            "fetched_at": fetched_at,
            "adjusted": adjusted,
            "corporate_actions_complete": True,
            "bars": [bar.serialize() for bar in bars],
        }
        cache.write_bars("yahoo_bars", key, payload)
        return SeriesResult(
            symbol=symbol,
            bars=bars,
            source=self.id,
            source_label=self.label,
            fetched_at=fetched_at,
            adjusted=adjusted,
            warnings=[] if adjusted else ["provider did not return adjusted closes"],
        )

    # ------------------------------------------------------------------- quote
    def fetch_quote(self, symbol: str) -> QuoteSnapshot:
        cached = cache.read("yahoo_quotes", symbol, settings.ttl_meta)
        # Quote caches created before the audit do not contain the fields needed
        # for exchange, security-type, and float-cap checks. Refetch those rows
        # instead of silently treating absent metadata as verified.
        if cached and "quote_type" in cached:
            return QuoteSnapshot(**cached)

        yf = _import_yfinance()
        _LIMITER.acquire()
        try:
            info = yf.Ticker(symbol).info
        except Exception as exc:  # noqa: BLE001
            raise ProviderUnavailable(str(exc)) from exc

        if not info or info.get("quoteType") == "NONE":
            raise ProviderNoData(f"no quote metadata for {symbol}")

        snapshot = QuoteSnapshot(
            symbol=symbol,
            name=info.get("shortName") or info.get("longName"),
            sector=info.get("sector"),
            exchange=info.get("fullExchangeName") or info.get("exchange"),
            market_cap=_num(info.get("marketCap")),
            currency=info.get("currency"),
            source=self.id,
            fetched_at=_now(),
            quote_type=info.get("quoteType"),
            shares_outstanding=_num(info.get("sharesOutstanding")),
            float_shares=_num(info.get("floatShares")),
            average_daily_volume_3m=_num(info.get("averageDailyVolume3Month") or info.get("averageVolume")),
            regular_market_price=_num(info.get("regularMarketPrice") or info.get("currentPrice")),
        )
        cache.write("yahoo_quotes", symbol, snapshot.__dict__)
        return snapshot


def cache_ttl() -> int:
    """Bars go stale quickly while the market is open, slowly once it is closed."""
    from ..clock import market_state  # local import avoids a cycle

    return settings.ttl_bars_intraday if market_state()["is_open"] else settings.ttl_bars_closed


def _num(value) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        if number != number:  # NaN
            return None
        return number
    except (TypeError, ValueError):
        return None

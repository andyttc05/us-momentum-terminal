"""Yahoo Finance adapter.

Uses the ``yfinance`` client, which performs the cookie + crumb handshake that
Yahoo's raw chart endpoint requires (the raw endpoint answers HTTP 429 without
it - verified during the provider probe). Yahoo is the only provider in this
project's probe that returned adjusted closes, market caps, splits and
dividends for every sample ticker without an API key.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from datetime import datetime, timezone

import pandas as pd

from .. import cache
from ..config import settings
from ..models import (
    NormalizedBar,
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
_DETAIL_QUOTE_LOCK = threading.Lock()


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


def _series_from_cache(cached: dict, *, is_fresh: bool, cache_key: str | None = None) -> SeriesResult:
    key = cache_key or f"{cached['symbol']}:{settings.history_years}y"
    age = 0.0 if is_fresh else cache.age_seconds("yahoo_bars", key)
    return SeriesResult(
        symbol=cached["symbol"],
        bars=[NormalizedBar(**row) for row in cached["bars"]],
        source=YahooProvider.id,
        source_label=YahooProvider.label,
        fetched_at=cached["fetched_at"],
        adjusted=cached["adjusted"],
        cached=not is_fresh,
        cache_age_seconds=age,
        warnings=[
            *cached.get("warnings", []),
            *cached.get("quality_warnings", []),
            *([] if is_fresh else [f"serving cached bars; live refresh failed ({age or 0:.0f}s old)"]),
        ],
    )


def _cache_bars_are_complete(cached: dict, *, min_bars: int | None = None) -> bool:
    """Validate cached adjusted history without trusting its metadata alone.

    A cache entry can contain trailing rows from an in-progress session whose
    adjusted close has not been published yet. Those rows are ignored, but an
    interior adjusted-close gap is a quality failure and is never accepted.
    """
    if not cached or not cached.get("adjusted"):
        return False
    minimum = max(1, int(min_bars or settings.yahoo_min_bars))
    rows = cached.get("bars") or []
    close_rows = [
        row for row in rows
        if isinstance(row.get("close"), (int, float)) and row["close"] > 0
    ]
    adjusted_positions = [
        index for index, row in enumerate(close_rows)
        if isinstance(row.get("adjusted_close"), (int, float)) and row["adjusted_close"] > 0
    ]
    if len(adjusted_positions) < minimum:
        return False
    last_adjusted = adjusted_positions[-1]
    return all(
        isinstance(row.get("adjusted_close"), (int, float)) and row["adjusted_close"] > 0
        for row in close_rows[:last_adjusted + 1]
    )


def _prepare_history_frame(frame: pd.DataFrame, symbol: str) -> tuple[pd.DataFrame, list[str]]:
    """Return rows with a complete adjusted path and explicit quality reasons.

    Yahoo can append the current, still-forming session before its adjusted
    close is available. Such trailing rows are excluded. A missing adjusted
    close *inside* the retained history is rejected: filling it from the raw
    close would change total-return momentum and is never allowed.
    """
    if frame is None or frame.empty:
        raise ProviderNoData(f"empty history for {symbol}")
    required = ("Close", "Adj Close")
    missing_columns = [column for column in required if column not in frame.columns]
    if missing_columns:
        raise ProviderNoData(
            f"missing batch columns for {symbol}: {', '.join(missing_columns)}"
        )

    close = pd.to_numeric(frame["Close"], errors="coerce")
    adjusted = pd.to_numeric(frame["Adj Close"], errors="coerce")
    close_valid = close.notna() & (close > 0)
    adjusted_valid = adjusted.notna() & (adjusted > 0)
    if not close_valid.any():
        raise ProviderNoData(f"no usable close observations for {symbol}")
    adjusted_positions = [index for index, valid in enumerate(adjusted_valid) if valid]
    if not adjusted_positions:
        raise ProviderNoData(f"adjusted close is unavailable for {symbol}")

    last_adjusted = adjusted_positions[-1]
    interior_gaps = [
        index for index in range(last_adjusted + 1)
        if close_valid.iloc[index] and not adjusted_valid.iloc[index]
    ]
    if interior_gaps:
        raise ProviderNoData(
            f"adjusted close has {len(interior_gaps)} interior gap(s) for {symbol}"
        )

    cleaned = frame.loc[close_valid & adjusted_valid].copy()
    cleaned["Close"] = close.loc[cleaned.index]
    cleaned["Adj Close"] = adjusted.loc[cleaned.index]
    if len(cleaned) < max(1, settings.yahoo_min_bars):
        raise ProviderNoData(
            f"truncated history for {symbol}: {len(cleaned)} usable rows, "
            f"need {settings.yahoo_min_bars}"
        )
    trailing = int(close_valid.sum() - adjusted_valid.sum())
    warnings = (
        [f"excluded {trailing} incomplete trailing observation(s) without adjusted close"]
        if trailing > 0
        else []
    )
    return cleaned, warnings


def _complete(adjusted: bool, bars: list[NormalizedBar]) -> bool:
    return adjusted and len(bars) >= max(1, settings.yahoo_min_bars)


class _BatchMixin:
    """Yahoo can answer for many tickers in one HTTP round-trip."""

    def _download(self, yf, symbols: list[str], years: int):
        """Download one deliberately small Yahoo batch with bounded retries.

        ``yfinance.download`` can return a successful frame that is missing a
        subset of requested columns when Yahoo throttles one of its internal
        chart calls.  That is not a successful universe fetch: callers receive
        only the validated symbols and ``load_series`` recovers every omission
        individually (and through the configured provider chain).
        """
        last_error = None
        attempts = max(0, settings.yahoo_retry_attempts)
        for attempt in range(attempts + 1):
            _LIMITER.acquire(max(1, min(len(symbols), 8)))
            try:
                # yfinance itself fans out when threads=True. Serializing the
                # small batches avoids two outer workers multiplying that fan
                # out into a Yahoo rate-limit burst.
                with _BATCH_LOCK:
                    return yf.download(
                        symbols,
                        period=f"{years}y",
                        interval="1d",
                        auto_adjust=False,
                        actions=True,
                        group_by="ticker",
                        threads=False,
                        progress=False,
                        timeout=settings.request_timeout,
                    )
            except Exception as exc:  # noqa: BLE001 - normalized below
                last_error = exc
                if attempt < attempts:
                    delay = settings.yahoo_retry_base_seconds * (2 ** attempt)
                    time.sleep(delay + random.uniform(0, delay * 0.2))
        raise ProviderUnavailable(f"Yahoo batch failed after {attempts + 1} attempts: {last_error}")

    def fetch_many(self, symbols, years: int | None = None, issues: dict | None = None):
        symbols = list(symbols)
        ttl = cache_ttl()
        out: dict[str, SeriesResult] = {}
        pending: list[str] = []

        for symbol in symbols:
            cached = cache.read("yahoo_bars", f"{symbol}:{years or settings.history_years}y", ttl)
            if _cache_bars_are_complete(cached):
                out[symbol] = _series_from_cache(cached, is_fresh=True)
            else:
                pending.append(symbol)

        if not pending:
            return out

        yf = _import_yfinance()
        years = years or settings.history_years
        batch_size = max(1, settings.yahoo_batch_size)
        for start in range(0, len(pending), batch_size):
            batch = pending[start:start + batch_size]
            try:
                frame = self._download(yf, batch, years)
            except ProviderUnavailable as exc:
                # Do not manufacture empty SeriesResults. The caller's
                # per-symbol retry records the actual ticker failures.
                if issues is not None:
                    for symbol in batch:
                        issues[symbol] = {
                            "provider": self.id,
                            "stage": "batch_request",
                            "error": str(exc)[:200],
                            "category": "ProviderUnavailable",
                        }
                continue

            for symbol in batch:
                series_frame = None
                if frame is not None and not frame.empty:
                    try:
                        series_frame = frame[symbol] if isinstance(frame.columns, pd.MultiIndex) else frame
                    except KeyError:
                        series_frame = None
                if series_frame is None or series_frame.dropna(subset=["Close"]).empty:
                    if issues is not None:
                        issues[symbol] = {
                            "provider": self.id,
                            "stage": "batch_validation",
                            "error": "batch response omitted the ticker or returned no closes",
                            "category": "ProviderNoData",
                        }
                    continue

                try:
                    series_frame, quality_warnings = _prepare_history_frame(series_frame, symbol)
                except ProviderNoData as exc:
                    if issues is not None:
                        issues[symbol] = {
                            "provider": self.id,
                            "stage": "batch_validation",
                            "error": str(exc)[:200],
                            "category": type(exc).__name__,
                        }
                    continue
                fetched_at = _now()
                bars = []
                adjusted = True
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
                if not _complete(adjusted, bars):
                    # Drop this symbol from the batch result so load_series runs
                    # its individual retry and provider fallback chain.
                    continue
                cache.write_bars(
                    "yahoo_bars",
                    f"{symbol}:{years}y",
                    {
                        "symbol": symbol,
                        "fetched_at": fetched_at,
                        "adjusted": adjusted,
                        "corporate_actions_complete": True,
                        "quality_warnings": quality_warnings,
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
                    warnings=quality_warnings,
                )
                if issues is not None:
                    issues.pop(symbol, None)
        return out

    def fetch_many_with_diagnostics(self, symbols, years: int | None = None):
        """Batch entry point that also reports omitted or invalid tickers."""
        issues: dict[str, dict] = {}
        results = self.fetch_many(symbols, years, issues)
        return results, issues


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
        if _cache_bars_are_complete(cached):
            return _series_from_cache(cached, is_fresh=True)

        yf = _import_yfinance()
        frame = None
        quality_warnings: list[str] = []
        accepted = False
        last_error = None
        attempts = max(0, settings.yahoo_retry_attempts)
        for attempt in range(attempts + 1):
            _LIMITER.acquire()
            try:
                frame = yf.Ticker(symbol).history(
                    period=f"{years}y", interval="1d", auto_adjust=False,
                    actions=True, timeout=settings.request_timeout,
                )
                frame, quality_warnings = _prepare_history_frame(frame, symbol)
                accepted = True
                break
            except Exception as exc:  # noqa: BLE001 - normalize every client failure
                last_error = exc
            if attempt < attempts:
                delay = settings.yahoo_retry_base_seconds * (2 ** attempt)
                time.sleep(delay + random.uniform(0, delay * 0.2))

        if not accepted:
            message = str(last_error or f"no rows returned for {symbol}")
            stale = cache.read_stale("yahoo_bars", key)
            if _cache_bars_are_complete(stale):
                return _series_from_cache(stale, is_fresh=False, cache_key=key)
            if "429" in message or "Too Many Requests" in message:
                raise ProviderRateLimited(message) from last_error
            if isinstance(last_error, ProviderNoData):
                raise last_error
            raise ProviderUnavailable(message) from last_error

        fetched_at = _now()
        bars: list[NormalizedBar] = []
        adjusted = True
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
            "quality_warnings": quality_warnings,
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
            warnings=quality_warnings,
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
        fast = None
        last_error = None
        attempts = max(0, settings.yahoo_retry_attempts)
        for attempt in range(attempts + 1):
            _LIMITER.acquire()
            try:
                with _DETAIL_QUOTE_LOCK:
                    candidate = yf.Ticker(symbol).fast_info
                if (
                    candidate
                    and str(candidate.get("quoteType") or "") not in {"", "NONE"}
                    and candidate.get("exchange")
                ):
                    fast = candidate
                    break
                last_error = ProviderNoData(f"incomplete quote metadata for {symbol}")
            except Exception as exc:  # noqa: BLE001
                last_error = exc
            if attempt < attempts:
                delay = settings.yahoo_retry_base_seconds * (2 ** attempt)
                time.sleep(delay + random.uniform(0, delay * 0.2))

        if fast is None:
            stale = cache.read_stale("yahoo_quotes", symbol)
            if stale and "quote_type" in stale:
                return QuoteSnapshot(**{
                    **stale,
                    "cached": True,
                    "cache_age_seconds": cache.age_seconds("yahoo_quotes", symbol),
                })
            message = str(last_error or f"no quote metadata for {symbol}")
            if "429" in message or "Too Many Requests" in message:
                raise ProviderRateLimited(message) from last_error
            if isinstance(last_error, ProviderNoData):
                raise last_error
            raise ProviderUnavailable(message) from last_error

        quote_type = str(fast.get("quoteType") or "")

        snapshot = QuoteSnapshot(
            symbol=symbol,
            name=None,
            sector=None,
            exchange=fast.get("exchange"),
            market_cap=_num(fast.get("marketCap")),
            currency=fast.get("currency"),
            source=self.id,
            fetched_at=_now(),
            quote_type=quote_type,
            shares_outstanding=_num(fast.get("shares")),
            float_shares=None,
            average_daily_volume_3m=_num(fast.get("threeMonthAverageVolume")),
            regular_market_price=_num(fast.get("lastPrice")),
            detail_level="fast",
        )
        cache.write("yahoo_quotes", symbol, snapshot.__dict__)
        return snapshot

    def fetch_detailed_quote(self, symbol: str) -> QuoteSnapshot:
        cached = cache.read("yahoo_quotes", symbol, settings.ttl_meta)
        if cached and cached.get("float_shares") and cached.get("quote_type"):
            return QuoteSnapshot(**cached)

        yf = _import_yfinance()
        info = None
        last_error = None
        attempts = max(0, settings.yahoo_retry_attempts)
        for attempt in range(attempts + 1):
            _LIMITER.acquire()
            try:
                # yfinance's profile endpoint shares cookie/crumb state between
                # calls. Serializing it avoids Yahoo treating the candidate
                # recovery pass as a burst and returning metadata without the
                # float-share field.
                with _DETAIL_QUOTE_LOCK:
                    candidate = yf.Ticker(symbol).info
                float_shares = _num((candidate or {}).get("floatShares"))
                if (
                    candidate
                    and candidate.get("quoteType") not in {"", "NONE", None}
                    and float_shares is not None
                    and float_shares > 0
                ):
                    info = candidate
                    break
                last_error = ProviderNoData(f"incomplete detailed quote metadata for {symbol}")
            except Exception as exc:  # noqa: BLE001
                last_error = exc
            if attempt < attempts:
                delay = settings.yahoo_retry_base_seconds * (2 ** attempt)
                time.sleep(delay + random.uniform(0, delay * 0.2))

        if info is None:
            stale = cache.read_stale("yahoo_quotes", symbol)
            stale_age = cache.age_seconds("yahoo_quotes", symbol)
            if (
                stale
                and stale.get("float_shares")
                and stale_age <= settings.fundamental_fallback_max_age
            ):
                return QuoteSnapshot(**{
                    **stale,
                    "cached": True,
                    "cache_age_seconds": stale_age,
                })
            message = str(last_error or f"no detailed quote metadata for {symbol}")
            if "429" in message or "Too Many Requests" in message:
                raise ProviderRateLimited(message) from last_error
            if isinstance(last_error, ProviderNoData):
                raise last_error
            raise ProviderUnavailable(message) from last_error

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
            detail_level="full",
        )
        cache.write("yahoo_quotes", symbol, snapshot.__dict__)
        return snapshot


def share_history(symbol: str, start: str, end: str) -> list[list] | None:
    """Point-in-time share-count observations for one symbol.

    Yahoo publishes the share count that was in effect on each observation
    date. This is the only historical size input the project can obtain, so it
    is returned as reported (never restated for later splits) and the caller
    pairs it with the price of the same date. ``None`` means the provider has
    no series for the symbol, which must stay distinguishable from a fetch
    failure so coverage gaps are reported instead of silently filled.
    """
    yf = _import_yfinance()
    _LIMITER.acquire()
    try:
        series = yf.Ticker(symbol).get_shares_full(start=start, end=end)
    except Exception:  # noqa: BLE001 - provider failures surface as no data
        return None
    if series is None or len(series) == 0:
        return None
    points: list[list] = []
    for stamp, value in series.items():
        try:
            count = int(value)
        except (TypeError, ValueError):
            continue
        if count <= 0:
            continue
        points.append([stamp.strftime("%Y-%m-%d"), count])
    return points or None


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

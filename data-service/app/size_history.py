"""Point-in-time market capitalisation for historical portfolio sizing.

The Portfolio page sizes every holding with ``raw = score x (float cap / median
float cap) ** 0.5`` under a 9% single-name and 35% sector-group cap. The size
input comes from the *current* quote's float shares, which providers only ever
publish as today's snapshot. Reusing today's float shares on a 2019 rebalance
would leak future information into a past decision, so history needs its own
point-in-time input.

Providers do publish one series that was knowable at a past date: the share
count in effect on that date. Historical sizing therefore uses

    market cap on date D = share count in effect on D x unadjusted close on D

Both inputs are point-in-time and reproducible from cached data. The result is a
share-outstanding market capitalisation rather than a float-adjusted one,
because no provider in this project's chain publishes historical float shares.
That difference is recorded in the published methodology as ``size_input`` so a
sized historical book is never mistaken for the float-adjusted production rule.

Prices arrive split-normalised (the provider restates every close onto the
current split basis), so the share count is paired with the close multiplied by
the cumulative split factor of every split *after* that date. Without that step a
name with a later 4:1 split would be sized at a quarter of its true weight.
"""

from __future__ import annotations

import bisect
from datetime import date, datetime
from typing import Callable, Iterable

import pandas as pd

from . import cache
from .providers import yahoo

SHARE_NAMESPACE = "historical_shares"
SHARE_SOURCE = "yahoo:get_shares_full"
SHARE_HISTORY_START = "2014-01-01"

# Cached series are reused until their newest observation is older than this, so
# a long-running installation still picks up later share counts.
SHARE_REFRESH_DAYS = 90

# A share count is a slow-moving quantity, but provider series contain holes.
# The most recent disclosure at or before the signal date is the count that was
# actually knowable then; beyond two years the observation is treated as missing
# rather than stretched across a gap.
MAX_SHARE_AGE_DAYS = 750

# Ticker renames only extend coverage backwards. The legacy series describes the
# same listed company before the rename (FB -> META, UTX -> RTX, PX -> LIN), so
# joining them cannot introduce a different issuer.
RENAMED_SYMBOLS = {
    "META": "FB",
    "RTX": "UTX",
    "LIN": "PX",
}

SIZE_INPUT_NOTE = "point-in-time share count x unadjusted close"


def _iso(value: str) -> str | None:
    try:
        return datetime.fromisoformat(str(value)[:10]).date().isoformat()
    except (TypeError, ValueError):
        return None


def _parse(points: Iterable) -> list[tuple[str, int]]:
    parsed: dict[str, int] = {}
    for point in points or ():
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        stamp = _iso(point[0])
        try:
            count = int(point[1])
        except (TypeError, ValueError):
            continue
        if stamp and count > 0:
            parsed[stamp] = count
    return sorted(parsed.items())


def load_share_history(symbol: str) -> list[tuple[str, int]]:
    """Cached share-count observations for ``symbol``, oldest first."""
    cached = cache.read_stale(SHARE_NAMESPACE, symbol)
    if not cached:
        return []
    return _parse(cached.get("points"))


def fetch_share_history(symbol: str, end: str) -> list[tuple[str, int]]:
    """Fetch and cache one symbol's share history. Empty on provider failure."""
    points = yahoo.share_history(symbol, SHARE_HISTORY_START, end)
    if not points:
        return []
    cache.write(
        SHARE_NAMESPACE,
        symbol,
        {"symbol": symbol, "source": SHARE_SOURCE, "points": points},
    )
    return _parse(points)


def _is_fresh(points: list[tuple[str, int]], end: str) -> bool:
    if not points:
        return False
    try:
        horizon = date.fromisoformat(str(end)[:10])
        latest = date.fromisoformat(points[-1][0])
    except (TypeError, ValueError):
        return False
    return (horizon - latest).days <= SHARE_REFRESH_DAYS


def _ensure_one(symbol: str, end: str) -> tuple[bool, bool]:
    """Resolve one symbol. Returns ``(resolved, fetched)``."""
    history = load_share_history(symbol)
    if _is_fresh(history, end):
        return True, False
    if fetch_share_history(symbol, end):
        return True, True
    # A stale disclosure is still a real one; dropping it would push the whole
    # rebalance back onto the equal-weight proxy.
    return bool(history), False


def ensure_share_history(
    symbols: Iterable[str],
    *,
    end: str,
    progress: Callable[[int, int], None] | None = None,
) -> dict[str, int]:
    """Make sure every symbol has a current cached series, fetching what is stale.

    A cold cache must never silently downgrade a sized book to the equal-weight
    proxy, so the pipeline calls this before any historical simulation. A renamed
    ticker also resolves its predecessor's series; symbols the provider has no
    series for are reported, not substituted.
    """
    requested = list(dict.fromkeys(symbols))
    resolved = 0
    fetched = 0
    missing: list[str] = []
    for index, symbol in enumerate(requested, start=1):
        legacy = RENAMED_SYMBOLS.get(symbol)
        if legacy:
            _legacy_resolved, legacy_fetched = _ensure_one(legacy, end)
            fetched += int(legacy_fetched)
        current_resolved, current_fetched = _ensure_one(symbol, end)
        fetched += int(current_fetched)
        if current_resolved or (legacy and load_share_history(legacy)):
            resolved += 1
        else:
            missing.append(symbol)
        if progress is not None and (index % 10 == 0 or index == len(requested)):
            progress(index, len(requested))
    return {
        "requested": len(requested),
        "resolved": resolved,
        "fetched": fetched,
        "missing": missing,
    }


def _merged_history(symbol: str) -> list[tuple[str, int]]:
    """Current-symbol series joined with its predecessor's series, if any."""
    points = dict(load_share_history(symbol))
    legacy = RENAMED_SYMBOLS.get(symbol)
    if legacy:
        for stamp, count in load_share_history(legacy):
            points.setdefault(stamp, count)
    return sorted(points.items())


class _PriceBasis:
    """Split-normalised closes with the cumulative split factor of each date."""

    __slots__ = ("dates", "prices")

    def __init__(self, frame: pd.DataFrame):
        stamps = [stamp.strftime("%Y-%m-%d") for stamp in frame.index]
        closes = [float(value) for value in frame["close"].tolist()]
        splits = (
            [float(value or 0.0) for value in frame["splits"].tolist()]
            if "splits" in frame
            else [0.0] * len(stamps)
        )
        prices = [0.0] * len(stamps)
        running = 1.0
        for position in range(len(stamps) - 1, -1, -1):
            prices[position] = closes[position] * running
            ratio = splits[position]
            if ratio > 0:
                running *= ratio
        self.dates = stamps
        self.prices = prices


def market_cap_lookup(
    series_map: dict,
    *,
    max_share_age_days: int = MAX_SHARE_AGE_DAYS,
) -> Callable[[str, object], float | None]:
    """Build the ``(symbol, signal_date) -> market cap`` callable the backtest uses."""
    basis_cache: dict[str, _PriceBasis | None] = {}
    share_cache: dict[str, list[tuple[str, int]]] = {}

    def basis_for(symbol: str) -> _PriceBasis | None:
        if symbol not in basis_cache:
            series = series_map.get(symbol)
            frame = getattr(series, "frame", None)
            basis_cache[symbol] = (
                _PriceBasis(frame)
                if frame is not None and not frame.empty and "close" in frame
                else None
            )
        return basis_cache[symbol]

    def shares_for(symbol: str) -> list[tuple[str, int]]:
        if symbol not in share_cache:
            share_cache[symbol] = _merged_history(symbol)
        return share_cache[symbol]

    def lookup(symbol: str, signal_date) -> float | None:
        basis = basis_for(symbol)
        if basis is None or not basis.dates:
            return None
        stamp = (
            signal_date.strftime("%Y-%m-%d")
            if hasattr(signal_date, "strftime")
            else str(signal_date)[:10]
        )
        position = bisect.bisect_right(basis.dates, stamp) - 1
        if position < 0:
            return None
        price_date = basis.dates[position]
        price = basis.prices[position]
        if price <= 0:
            return None

        history = shares_for(symbol)
        if not history:
            return None
        share_dates = [point[0] for point in history]
        share_position = bisect.bisect_right(share_dates, price_date) - 1
        if share_position < 0:
            return None
        share_date, count = history[share_position]
        if (date.fromisoformat(price_date) - date.fromisoformat(share_date)).days > max_share_age_days:
            return None
        return price * count

    lookup.size_input = SIZE_INPUT_NOTE
    lookup.size_basis = "shares_outstanding"
    return lookup

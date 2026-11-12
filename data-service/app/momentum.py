"""Adjusted-close momentum calculations.

Windows are trading sessions: 21, 63, 126 and 252. The headline 12-1 signal is
P(t-21) / P(t-252) - 1. Symbols without the full window are excluded rather
than scored on a shorter history, and missing adjusted prices are never filled
from unadjusted closes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

TRADING_DAYS = {"1M": 21, "3M": 63, "6M": 126, "12M": 252}
MIN_OBSERVATIONS = 253
Z_CLIP = 3.0


@dataclass
class SymbolSeries:
    symbol: str
    frame: pd.DataFrame            # index: DatetimeIndex, columns: adj, close, volume, dividends, splits
    source: str
    source_label: str
    fetched_at: str
    adjusted: bool
    is_backup: bool
    cached: bool = False
    cache_age_seconds: float | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def rows(self) -> int:
        return int(len(self.frame))

    @property
    def latest_date(self) -> str:
        return self.frame.index[-1].strftime("%Y-%m-%d") if len(self.frame) else ""


def build_frame(bars) -> pd.DataFrame | None:
    """Turn normalized bars into a clean, sorted, de-duplicated frame."""
    if not bars:
        return None
    records = []
    for bar in bars:
        records.append(
            {
                "date": bar.date,
                "adj": bar.adjusted_close,
                "close": bar.close,
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "volume": bar.volume,
                "dividends": bar.dividends,
                "splits": bar.stock_splits,
            }
        )
    frame = pd.DataFrame(records)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.dropna(subset=["date", "adj", "close"])
    frame = frame[frame["adj"] > 0]
    frame = frame.drop_duplicates(subset="date", keep="last").sort_values("date").set_index("date")
    if frame.empty:
        return None
    return frame


def _window_metrics(adj: np.ndarray, index: int) -> dict | None:
    """Metrics for the observation at positional ``index`` (0-based)."""
    if index < TRADING_DAYS["12M"]:
        return None
    p0 = float(adj[index])
    p1m = float(adj[index - TRADING_DAYS["1M"]])
    p3m = float(adj[index - TRADING_DAYS["3M"]])
    p6m = float(adj[index - TRADING_DAYS["6M"]])
    p12m = float(adj[index - TRADING_DAYS["12M"]])
    if min(p0, p1m, p3m, p6m, p12m) <= 0:
        return None

    window = adj[index - 252: index + 1]
    if len(window) < 253:
        return None
    returns = np.diff(window) / window[:-1]
    daily_volatility = float(np.std(returns, ddof=1))
    if not np.isfinite(daily_volatility) or daily_volatility <= 1e-12:
        return None

    momentum_12_1_decimal = p1m / p12m - 1.0
    return {
        "momentum_1m": (p0 / p1m - 1.0) * 100.0,
        "momentum_3m": (p0 / p3m - 1.0) * 100.0,
        "momentum_6m": (p0 / p6m - 1.0) * 100.0,
        "momentum_12m": (p0 / p12m - 1.0) * 100.0,
        "momentum_12_1": momentum_12_1_decimal * 100.0,
        "volatility": daily_volatility * np.sqrt(252) * 100.0,
        "daily_volatility": daily_volatility,
        "risk_adjusted": momentum_12_1_decimal / daily_volatility,
    }


def _zscore(values: list[float]) -> list[float]:
    array = np.asarray(values, dtype=float)
    if array.size < 2:
        return [0.0] * len(values)
    std = float(np.std(array, ddof=0))
    if std == 0 or not np.isfinite(std):
        return [0.0] * len(values)
    mean = float(np.mean(array))
    # Cap the cross-sectional Z-score before applying the score transform.
    return [float(np.clip((value - mean) / std, -Z_CLIP, Z_CLIP)) for value in array]


def momentum_score(z_score: float) -> float:
    """Apply the asymmetric piecewise score transformation."""
    if z_score > 0:
        return 1.0 + z_score
    if z_score < 0:
        return 1.0 / (1.0 - z_score)
    return 1.0


display_score = momentum_score


def compute_snapshot(series_map: dict[str, SymbolSeries]) -> tuple[list[dict], list[dict]]:
    """Cross-sectional snapshot for the latest observation.

    Returns ``(scored, excluded)``. ``scored`` rows are ranked by final score.
    """
    scored: list[dict] = []
    excluded: list[dict] = []

    for symbol, series in series_map.items():
        if not series.adjusted:
            excluded.append({"symbol": symbol, "reason": "no adjusted close from provider", "rows": series.rows})
            continue
        if series.rows < MIN_OBSERVATIONS:
            excluded.append(
                {"symbol": symbol, "reason": f"only {series.rows} daily observations (need {MIN_OBSERVATIONS})", "rows": series.rows}
            )
            continue
        adj = series.frame["adj"].to_numpy(dtype=float)
        metrics = _window_metrics(adj, len(adj) - 1)
        if metrics is None:
            excluded.append({"symbol": symbol, "reason": "insufficient history for the 12-1 window", "rows": series.rows})
            continue
        scored.append(
            {
                "symbol": symbol,
                **metrics,
                "price": round(float(series.frame["close"].iloc[-1]), 4),
                "adjusted_price": round(float(adj[-1]), 4),
                "volume": float(series.frame["volume"].iloc[-1] or 0),
                "date": series.frame.index[-1].strftime("%Y-%m-%d"),
                "source": series.source,
                "source_label": series.source_label,
                "fetched_at": series.fetched_at,
                "is_backup": series.is_backup,
                "cached": series.cached,
                "cache_age_seconds": series.cache_age_seconds,
                "observations": series.rows,
                "warnings": series.warnings,
            }
        )

    if not scored:
        return [], excluded

    cross_sectional_z = _zscore([row["risk_adjusted"] for row in scored])

    for index, row in enumerate(scored):
        z_score = cross_sectional_z[index]
        row["z_score"] = round(z_score, 6)
        row["score"] = round(momentum_score(z_score), 6)

    scored.sort(key=lambda row: (-row["score"], -row["risk_adjusted"], row["symbol"]))
    for rank, row in enumerate(scored, start=1):
        row["rank"] = rank
    return scored, excluded


def compute_daily_change(series: SymbolSeries) -> tuple[float, float]:
    """(absolute change, percent change) for the latest session."""
    frame = series.frame
    if len(frame) < 2:
        return 0.0, 0.0
    previous = float(frame["close"].iloc[-2])
    latest = float(frame["close"].iloc[-1])
    if previous <= 0:
        return 0.0, 0.0
    return round(latest - previous, 4), round((latest / previous - 1) * 100, 2)


def sparkline_points(series: SymbolSeries, weeks: int = 12) -> list[float]:
    """Weekly closes over the trailing window - used for the row sparklines."""
    adj = series.frame["adj"].dropna()
    if adj.empty:
        return []
    weekly = adj.resample("W-FRI").last().dropna()
    tail = weekly.tail(weeks)
    if len(tail) < 2:
        return [round(float(value), 2) for value in adj.tail(weeks)]
    # Normalize so the sparkline geometry is stable regardless of price level.
    base = float(tail.iloc[0])
    return [round(float(value) / base * 100, 2) for value in tail]


def momentum_sparkline(series: SymbolSeries) -> dict | None:
    """Adjusted-price path for the exact 12-1 momentum observation window."""
    if not series.adjusted:
        return None
    frame = series.frame
    end_index = len(frame) - 1 - TRADING_DAYS["1M"]
    start_index = len(frame) - 1 - TRADING_DAYS["12M"]
    if start_index < 0 or end_index <= start_index:
        return None
    window = frame["adj"].iloc[start_index:end_index + 1].dropna()
    if len(window) < 2:
        return None
    base = float(window.iloc[0])
    ending = float(window.iloc[-1])
    if base <= 0 or ending <= 0:
        return None
    return {
        "values": [round(float(value) / base * 100.0, 4) for value in window],
        "startDate": window.index[0].strftime("%Y-%m-%d"),
        "endDate": window.index[-1].strftime("%Y-%m-%d"),
        "startAdjustedClose": round(base, 4),
        "endAdjustedClose": round(ending, 4),
        "returnPct": round((ending / base - 1.0) * 100.0, 4),
        "startOffsetSessions": TRADING_DAYS["12M"],
        "endOffsetSessions": TRADING_DAYS["1M"],
    }


def monthly_history(series: SymbolSeries, months: int = 12) -> list[dict]:
    """Month-end metrics for one symbol (no look-ahead)."""
    frame = series.frame
    if not series.adjusted or len(frame) < MIN_OBSERVATIONS:
        return []
    monthly = frame["adj"].resample("ME").last().dropna()
    history = []
    for stamp in monthly.index[-months:]:
        position = int(frame.index.searchsorted(stamp, side="right") - 1)
        metrics = _window_metrics(frame["adj"].to_numpy(dtype=float), position)
        if metrics is None:
            continue
        history.append(
            {
                "date": stamp.strftime("%Y-%m-%d"),
                "month": stamp.strftime("%b"),
                "momentum_12_1": round(metrics["momentum_12_1"], 2),
                "risk_adjusted": metrics["risk_adjusted"],
                "daily_volatility": metrics["daily_volatility"],
            }
        )
    return history


def cross_section_at(
    series_map: dict[str, SymbolSeries],
    position_lookup,
    *,
    include=None,
) -> dict[str, dict]:
    """Cross-sectional scores at an arbitrary point in history.

    ``position_lookup(series)`` returns the positional index to evaluate.
    Used by the backtest so each rebalance only sees data available at that date.
    """
    rows = []
    for symbol, series in series_map.items():
        if not series.adjusted:
            continue
        position = position_lookup(series)
        if position is None or position < TRADING_DAYS["12M"]:
            continue
        if include is not None and not include(series, position):
            continue
        metrics = _window_metrics(series.frame["adj"].to_numpy(dtype=float), position)
        if metrics is None:
            continue
        rows.append({"symbol": symbol, **metrics, "position": position})

    if len(rows) < 5:
        return {}

    z_scores = _zscore([row["risk_adjusted"] for row in rows])
    out = {}
    for index, row in enumerate(rows):
        row["z_score"] = round(z_scores[index], 6)
        row["score"] = round(momentum_score(z_scores[index]), 6)
        out[row["symbol"]] = row
    return out

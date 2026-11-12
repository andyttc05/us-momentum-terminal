"""Semiannual, price-history backtest for the momentum ranking.

Signals are formed at the last trading session of March and September. Trades
are executed at the next available session close, and existing holdings are
marked to market every session between rebalances.

The historical book uses equal weights. Float-adjusted market caps with
point-in-time share counts are not available from the current providers, so a
capital-weighted historical book would either use look-ahead information or
pretend that current capitalisations applied in the past.
"""

from __future__ import annotations

import math

import pandas as pd

from .momentum import cross_section_at

MIN_UNIVERSE_OBSERVATIONS = 210
LIQUIDITY_SESSIONS = 63
MIN_PRICE = 5.0
MIN_AVERAGE_DAILY_DOLLAR_VOLUME = 2_000_000.0
REBALANCE_MONTHS = frozenset({3, 9})
TRANSACTION_COST_RATE = 0.001
SLIPPAGE_RATE = 0.0
RISK_FREE_RATE = 0.0


def _wide_frame(series_map) -> pd.DataFrame:
    columns = {}
    for symbol, series in series_map.items():
        if not series.adjusted or series.rows < LIQUIDITY_SESSIONS:
            continue
        columns[symbol] = series.frame["adj"]
    if not columns:
        return pd.DataFrame()
    return pd.DataFrame(columns).sort_index()


def historical_universe_eligible(series, position: int) -> bool:
    """Apply price, history, and liquidity checks using only past observations."""
    if position + 1 < MIN_UNIVERSE_OBSERVATIONS:
        return False
    window = series.frame.iloc[max(0, position - LIQUIDITY_SESSIONS + 1): position + 1]
    if len(window) < LIQUIDITY_SESSIONS:
        return False
    price = float(window["close"].iloc[-1])
    if not math.isfinite(price) or price < MIN_PRICE:
        return False
    dollar_volume = window["close"] * window["volume"]
    dollar_volume = dollar_volume.dropna()
    if len(dollar_volume) < LIQUIDITY_SESSIONS:
        return False
    return float(dollar_volume.mean()) >= MIN_AVERAGE_DAILY_DOLLAR_VOLUME


def _selection_count(ranked: list[dict], top_n: int | None, top_fraction: float | None) -> int:
    if top_fraction is not None:
        return max(1, math.ceil(len(ranked) * top_fraction))
    if top_n is not None:
        return max(1, min(int(top_n), len(ranked)))
    return max(1, len(ranked))


def _mark_to_market(
    holdings: dict[str, float],
    previous_prices: dict[str, float],
    prices: pd.DataFrame,
    stamp: pd.Timestamp,
) -> float:
    for symbol, value in list(holdings.items()):
        previous = previous_prices.get(symbol)
        current = prices.at[stamp, symbol] if symbol in prices.columns else None
        if previous and current and pd.notna(current):
            holdings[symbol] = value * float(current) / previous
            previous_prices[symbol] = float(current)
    return sum(holdings.values())


def run_backtest(
    series_map,
    *,
    top_n: int | None = 100,
    top_fraction: float | None = None,
    months: int = 120,
    benchmark_symbols: tuple[str, ...] = ("SPY", "SPMO"),
    universe_symbols: set[str] | None = None,
    rebalance_months: tuple[int, ...] = tuple(sorted(REBALANCE_MONTHS)),
    transaction_cost_rate: float = TRANSACTION_COST_RATE,
    slippage_rate: float = SLIPPAGE_RATE,
) -> dict:
    """Run a semiannual ranking simulation with explicit execution timing."""
    prices = _wide_frame(series_map)
    if prices.empty:
        return {"available": False, "reason": "no price data"}
    prices = prices.ffill()

    universe = set(universe_symbols or (set(series_map) - set(benchmark_symbols)))
    candidates = {symbol: series_map[symbol] for symbol in universe if symbol in series_map}
    if not candidates:
        return {"available": False, "reason": "no eligible universe symbols"}

    month_ends = prices.resample("ME").last().dropna(how="all").index
    month_ends = [
        stamp
        for stamp in month_ends
        if prices.index.searchsorted(stamp, side="right") >= MIN_UNIVERSE_OBSERVATIONS
    ][-months:]
    rebalance_set = frozenset(int(month) for month in rebalance_months)
    signal_dates = [stamp for stamp in month_ends if stamp.month in rebalance_set]
    if not signal_dates:
        return {"available": False, "reason": "no March or September signal dates"}

    events = []
    for signal in signal_dates:
        execution_position = int(prices.index.searchsorted(signal, side="right"))
        if execution_position >= len(prices.index):
            continue
        signal_date = prices.index[execution_position - 1]

        def lookup(series, stamp=signal_date):
            position = int(series.frame.index.searchsorted(stamp, side="right") - 1)
            return position if position >= 0 else None

        scores = cross_section_at(candidates, lookup, include=historical_universe_eligible)
        if len(scores) < 5:
            continue
        ranked = sorted(scores.values(), key=lambda row: (-row["score"], row["symbol"]))
        selected = [row["symbol"] for row in ranked[:_selection_count(ranked, top_n, top_fraction)]]
        if not selected:
            continue
        events.append(
            {
                "signal_position": execution_position - 1,
                "execution_position": execution_position,
                "selected": selected,
            }
        )

    if not events:
        return {"available": False, "reason": "no rebalance produced an eligible ranking"}

    nav = 100.0
    nav_dates: list[pd.Timestamp] = []
    nav_values: list[float] = []
    holdings_log: list[dict] = []
    holdings: dict[str, float] = {}
    previous_prices: dict[str, float] = {}
    total_cost = 0.0
    total_one_way_turnover = 0.0

    for event_index, event in enumerate(events):
        start_position = event["execution_position"]
        end_position = (
            events[event_index + 1]["execution_position"]
            if event_index + 1 < len(events)
            else len(prices.index)
        )
        start = prices.index[start_position]
        targets = event["selected"]

        if not holdings:
            nav_before = nav
            trade_notional = nav_before
            one_way_turnover = 1.0
        else:
            nav_before = _mark_to_market(holdings, previous_prices, prices, start)
            target_values = {symbol: nav_before * (1.0 / len(targets)) for symbol in targets}
            all_symbols = set(holdings) | set(targets)
            trade_notional = sum(
                abs(target_values.get(symbol, 0.0) - holdings.get(symbol, 0.0))
                for symbol in all_symbols
            )
            one_way_turnover = trade_notional / (2.0 * nav_before) if nav_before > 0 else 0.0

        cost = trade_notional * (transaction_cost_rate + slippage_rate)
        nav_after_trade = max(0.0, nav_before - cost)
        nav = nav_after_trade
        weight = 1.0 / len(targets)
        holdings = {symbol: nav_after_trade * weight for symbol in targets}
        previous_prices = {
            symbol: float(prices.at[start, symbol])
            for symbol in targets
            if symbol in prices.columns and pd.notna(prices.at[start, symbol])
        }

        nav_dates.append(start)
        nav_values.append(nav)
        total_cost += cost
        total_one_way_turnover += one_way_turnover
        holdings_log.append(
            {
                "signal_date": prices.index[event["signal_position"]].strftime("%Y-%m-%d"),
                "execution_date": start.strftime("%Y-%m-%d"),
                "count": len(targets),
                "leaders": targets[:5],
                "turnover_pct": round(one_way_turnover * 100.0, 2),
                "cost_usd": round(cost, 4),
            }
        )

        for position in range(start_position + 1, end_position):
            stamp = prices.index[position]
            nav = _mark_to_market(holdings, previous_prices, prices, stamp)
            nav_dates.append(stamp)
            nav_values.append(nav)

    if len(nav_values) < 20:
        return {"available": False, "reason": "not enough post-rebalance observations"}

    strategy = pd.Series(nav_values, index=pd.DatetimeIndex(nav_dates)).sort_index()
    strategy = strategy[~strategy.index.duplicated(keep="last")]
    benchmark_series = {}
    for symbol in benchmark_symbols:
        series = series_map.get(symbol)
        if series is None or series.rows < 60:
            continue
        closes = series.frame["adj"].loc[
            (series.frame.index >= strategy.index[0]) & (series.frame.index <= strategy.index[-1])
        ]
        if not closes.empty:
            benchmark_series[symbol] = closes / closes.iloc[0] * 100.0

    drawdown = (strategy / strategy.cummax() - 1.0) * 100.0
    monthly = strategy.resample("ME").last().dropna()
    monthly_benchmarks = {
        symbol: values.resample("ME").last().dropna()
        for symbol, values in benchmark_series.items()
    }

    annual = []
    for year in sorted(strategy.index.year.unique()):
        same_year = strategy[strategy.index.year == year]
        if same_year.empty:
            continue
        prior = strategy[strategy.index.year < year]
        base = float(prior.iloc[-1]) if not prior.empty else float(same_year.iloc[0])
        entry = {"year": int(year), "strategy": round((float(same_year.iloc[-1]) / base - 1) * 100, 1)}
        for symbol, values in benchmark_series.items():
            benchmark_year = values[values.index.year == year]
            if benchmark_year.empty:
                entry[symbol.lower()] = None
                continue
            benchmark_prior = values[values.index.year < year]
            benchmark_base = (
                float(benchmark_prior.iloc[-1])
                if not benchmark_prior.empty
                else float(benchmark_year.iloc[0])
            )
            entry[symbol.lower()] = round((float(benchmark_year.iloc[-1]) / benchmark_base - 1) * 100, 1)
        annual.append(entry)
    annual = annual[-8:]

    returns = strategy.pct_change().dropna()
    std = float(returns.std()) if len(returns) > 1 else 0.0
    annualized_volatility = std * math.sqrt(252) * 100.0 if std > 0 else None
    sharpe = None
    if len(returns) >= 20 and std > 0:
        daily_risk_free = (1.0 + RISK_FREE_RATE) ** (1.0 / 252.0) - 1.0
        sharpe = round(float((returns.mean() - daily_risk_free) / std * math.sqrt(252)), 2)

    total = float(strategy.iloc[-1] / 100.0)
    days = max(1, (strategy.index[-1] - strategy.index[0]).days)
    cagr = round((total ** (365.0 / days) - 1.0) * 100.0, 1) if total > 0 else None
    max_drawdown = round(float(drawdown.min()), 1)
    years = max(len(strategy) / 252.0, 1.0 / 252.0)

    return {
        "available": True,
        "start": strategy.index[0].strftime("%Y-%m-%d"),
        "end": strategy.index[-1].strftime("%Y-%m-%d"),
        "strategy": strategy,
        "benchmarks": benchmark_series,
        "drawdown": drawdown,
        "monthly": monthly,
        "monthly_benchmarks": monthly_benchmarks,
        "annual": annual,
        "holdings_log": holdings_log,
        "methodology": {
            "selection": "top 100" if top_fraction is None and top_n == 100 else (
                f"top {top_fraction:.0%}" if top_fraction is not None else f"top {top_n}"
            ),
            "weighting": "equal weight (research proxy)",
            "signal_months": sorted(rebalance_set),
            "execution": "next available adjusted close",
            "transaction_cost_bps": transaction_cost_rate * 10_000,
            "slippage_bps": slippage_rate * 10_000,
            "risk_free_rate": RISK_FREE_RATE,
            "historical_capitalisation": "not available point-in-time",
        },
        "metrics": {
            "cumulative_return": round((total - 1.0) * 100.0, 1),
            "cagr": cagr,
            "annualized_volatility": round(annualized_volatility, 1) if annualized_volatility is not None else None,
            "max_drawdown": max_drawdown,
            "sharpe": sharpe,
            "risk_free_rate": RISK_FREE_RATE,
            "transaction_cost_pct": round(total_cost, 4),
            "total_one_way_turnover_pct": round(total_one_way_turnover * 100.0, 1),
            "annualized_one_way_turnover_pct": round(total_one_way_turnover / years * 100.0, 1),
        },
    }


def monthly_series(backtest: dict) -> dict:
    """Monthly chart points for strategy and benchmark series."""
    monthly = backtest["monthly"]
    values = [round(float(value), 2) for value in monthly.values]
    benchmarks = {
        symbol: [round(float(value), 2) for value in series.reindex(monthly.index).ffill().values]
        for symbol, series in backtest["monthly_benchmarks"].items()
    }
    return {
        "months": [stamp.strftime("%Y-%m-%d") for stamp in monthly.index],
        "strategy": values,
        **{symbol.lower(): series for symbol, series in benchmarks.items()},
    }

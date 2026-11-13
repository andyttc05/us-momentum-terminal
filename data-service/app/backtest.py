"""Price-history backtest for the momentum ranking.

Signals are formed on the final trading session of each scheduled month. Trades
execute at the next available session close, and existing holdings are marked
to market every session between rebalances. The historical book starts from
equal weights and applies the same stock and sector caps as the live portfolio.
Point-in-time float capitalisation is unavailable, so using today's float caps
historically would introduce look-ahead bias.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .momentum import cross_section_at
from .portfolio import _apply_caps, group_sector

MIN_UNIVERSE_OBSERVATIONS = 210
LIQUIDITY_SESSIONS = 63
MIN_PRICE = 5.0
MIN_AVERAGE_DAILY_DOLLAR_VOLUME = 2_000_000.0
REBALANCE_FREQUENCIES = {
    "monthly": tuple(range(1, 13)),
    "quarterly": (3, 6, 9, 12),
    "semiannual": (3, 9),
    "annual": (9,),
}
REBALANCE_LABELS = {
    "monthly": "Monthly (Every Month)",
    "quarterly": "Quarterly (Mar / Jun / Sep / Dec)",
    "semiannual": "Semiannual (Mar / Sep)",
    "annual": "Annual (September)",
}
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


def _price_cash_frames(series_map) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split-adjusted closes and per-share cash dividends.

    The provider's adjusted close includes dividend reinvestment. To support a
    dividend-exclusive account without counting those distributions twice, we
    use the provider's Close, which Yahoo and FMP already normalize to the
    current split basis. Applying the separate split actions again would
    multiply historical wealth by every historical split, so those actions are
    audited for completeness but never double-applied.
    """
    price_columns = {}
    dividend_columns = {}
    for symbol, series in series_map.items():
        if not series.adjusted or series.rows < LIQUIDITY_SESSIONS:
            continue
        close = pd.to_numeric(series.frame["close"], errors="coerce")
        dividends = pd.to_numeric(series.frame.get("dividends"), errors="coerce").fillna(0.0)
        price_columns[symbol] = close
        dividend_columns[symbol] = dividends
    if not price_columns:
        return pd.DataFrame(), pd.DataFrame()
    return (
        pd.DataFrame(price_columns).sort_index().ffill(),
        pd.DataFrame(dividend_columns).sort_index().fillna(0.0),
    )


def _mark_cash_dividend_account(
    holdings: dict[str, float],
    previous_prices: dict[str, float],
    prices: pd.DataFrame,
    dividends: pd.DataFrame,
    stamp: pd.Timestamp,
    cash: float,
) -> float:
    for symbol, value in list(holdings.items()):
        previous = previous_prices.get(symbol)
        current = prices.at[stamp, symbol] if symbol in prices.columns else None
        if previous and current and pd.notna(current):
            holdings[symbol] = value * float(current) / previous
            previous_prices[symbol] = float(current)
            distribution = (
                float(dividends.at[stamp, symbol])
                if symbol in dividends.columns and pd.notna(dividends.at[stamp, symbol])
                else 0.0
            )
            if distribution > 0 and float(current) > 0:
                cash += holdings[symbol] / float(current) * distribution
    return sum(holdings.values()) + cash


def _cash_dividend_benchmark(series) -> pd.Series:
    """Price return with distributions retained as cash, normalized to 100."""
    prices, dividends = _price_cash_frames({series.symbol: series})
    if prices.empty:
        return pd.Series(dtype=float)
    frame = prices[series.symbol]
    distributions = dividends[series.symbol]
    shares = 100.0 / float(frame.iloc[0])
    cash = 0.0
    values = []
    for stamp, price in frame.items():
        distribution = float(distributions.loc[stamp])
        if distribution > 0:
            cash += shares * distribution
        values.append(shares * float(price) + cash)
    return pd.Series(values, index=frame.index, dtype=float)


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


def _selection_count(ranked: list[dict], top_n: int | None) -> int:
    if top_n is not None:
        return max(1, min(int(top_n), len(ranked)))
    return max(1, len(ranked))


def rebalance_schedule(
    trading_sessions,
    *,
    frequency: str = "semiannual",
    start=None,
    end=None,
) -> list[dict]:
    """Build unique initial-formation and scheduled rebalance events.

    Month-end signals are the final actual trading session in each selected
    month. A scheduled event is valid only when a later session is available
    for execution. When a start date is supplied, the first eligible session in
    the range forms the initial book; an event in that same formation month is
    skipped so the initial trade is not repeated.
    """
    if frequency not in REBALANCE_FREQUENCIES:
        raise ValueError(f"unsupported rebalance frequency: {frequency}")
    sessions = pd.DatetimeIndex(trading_sessions).sort_values().unique()
    if sessions.empty:
        return []
    months = frozenset(REBALANCE_FREQUENCIES[frequency])
    start_stamp = pd.Timestamp(start) if start is not None else None
    end_stamp = pd.Timestamp(end) if end is not None else None

    month_labels = sessions.to_period("M")
    month_lasts = pd.Series(sessions, index=sessions).groupby(month_labels).max()
    scheduled = []
    for signal in month_lasts:
        if signal.month not in months:
            continue
        signal_position = int(sessions.searchsorted(signal, side="left"))
        execution_position = signal_position + 1
        if execution_position >= len(sessions):
            continue
        execution = sessions[execution_position]
        if start_stamp is not None and execution < start_stamp:
            continue
        if end_stamp is not None and execution > end_stamp:
            continue
        scheduled.append(
            {
                "signal_position": signal_position,
                "execution_position": execution_position,
                "kind": "scheduled",
                "scheduled_month": int(signal.month),
            }
        )

    if start_stamp is None:
        if not scheduled:
            return []
        events = [dict(scheduled[0], kind="initial_formation", scheduled_month=None)]
        events.extend(scheduled[1:])
        return events

    formation_position = int(sessions.searchsorted(start_stamp, side="left"))
    formation_position = max(formation_position, MIN_UNIVERSE_OBSERVATIONS)
    if formation_position >= len(sessions):
        return []
    formation = sessions[formation_position]
    if end_stamp is not None and formation > end_stamp:
        return []
    events = [
        {
            "signal_position": formation_position - 1,
            "execution_position": formation_position,
            "kind": "initial_formation",
            "scheduled_month": None,
        }
    ]
    seen_executions = {formation_position}
    for event in scheduled:
        if event["execution_position"] <= formation_position:
            continue
        if event["execution_position"] in seen_executions:
            continue
        seen_executions.add(event["execution_position"])
        events.append(event)
    return sorted(events, key=lambda event: event["execution_position"])


def _target_weights(
    targets: list[str],
    sector_by_symbol: dict[str, str] | None,
) -> tuple[dict[str, float], str | None]:
    """Equal-start weights, with the live portfolio caps when sectors are known."""
    raw = {symbol: 1.0 for symbol in targets}
    if not sector_by_symbol or any(symbol not in sector_by_symbol for symbol in targets):
        equal = 100.0 / len(targets)
        return {symbol: equal for symbol in targets}, None
    sectors = {symbol: group_sector(sector_by_symbol[symbol]) for symbol in targets}
    weights, feasible, reason = _apply_caps(raw, sectors)
    return weights, None if feasible else reason


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
    benchmark_symbols: tuple[str, ...] = ("SPY", "SPMO"),
    universe_symbols: set[str] | None = None,
    rebalance_months: tuple[int, ...] | None = None,
    rebalance_frequency: str = "semiannual",
    start: str | None = None,
    end: str | None = None,
    sector_by_symbol: dict[str, str] | None = None,
    transaction_cost_rate: float = TRANSACTION_COST_RATE,
    slippage_rate: float = SLIPPAGE_RATE,
) -> dict:
    """Run a ranking simulation with explicit schedule and execution timing."""
    if rebalance_months is not None:
        requested_months = tuple(sorted({int(month) for month in rebalance_months}))
        matching = next(
            (
                name
                for name, months_for_frequency in REBALANCE_FREQUENCIES.items()
                if tuple(months_for_frequency) == requested_months
            ),
            None,
        )
        if matching is None:
            return {
                "available": False,
                "reason": f"unsupported rebalance months: {requested_months}",
            }
        rebalance_frequency = matching
    if rebalance_frequency not in REBALANCE_FREQUENCIES:
        return {"available": False, "reason": f"unsupported rebalance frequency: {rebalance_frequency}"}
    prices = _wide_frame(series_map)
    if prices.empty:
        return {"available": False, "reason": "no price data"}
    prices = prices.ffill()
    price_prices, price_dividends = _price_cash_frames(series_map)
    price_prices = price_prices.reindex(prices.index).ffill()

    universe = set(universe_symbols or (set(series_map) - set(benchmark_symbols)))
    candidates = {symbol: series_map[symbol] for symbol in universe if symbol in series_map}
    if not candidates:
        return {"available": False, "reason": "no eligible universe symbols"}

    rebalance_set = frozenset(REBALANCE_FREQUENCIES[rebalance_frequency])
    schedule = rebalance_schedule(
        prices.index,
        frequency=rebalance_frequency,
        start=start,
        end=end,
    )
    schedule = [event for event in schedule if event["scheduled_month"] is None or event["scheduled_month"] in rebalance_set]
    if not schedule:
        label = REBALANCE_LABELS[rebalance_frequency].split(" (", 1)[0]
        return {"available": False, "reason": f"no valid {label.lower()} signal dates in the selected period"}

    events = []
    for scheduled_event in schedule:
        execution_position = scheduled_event["execution_position"]
        signal_date = prices.index[scheduled_event["signal_position"]]

        def lookup(series, stamp=signal_date):
            position = int(series.frame.index.searchsorted(stamp, side="right") - 1)
            return position if position >= 0 else None

        scores = cross_section_at(candidates, lookup, include=historical_universe_eligible)
        if len(scores) < 5:
            continue
        ranked = sorted(scores.values(), key=lambda row: (-row["score"], row["symbol"]))
        selected = [row["symbol"] for row in ranked[:_selection_count(ranked, top_n)]]
        if not selected:
            continue
        target_weights, constraint_error = _target_weights(selected, sector_by_symbol)
        if constraint_error:
            return {
                "available": False,
                "reason": f"portfolio constraints infeasible on {signal_date:%Y-%m-%d}: {constraint_error}",
            }
        events.append(
            {
                "signal_position": scheduled_event["signal_position"],
                "execution_position": execution_position,
                # Failed-to-score warm-up events are skipped. The first actual
                # trade remains the initial formation even when its original
                # scheduled slot could not produce an eligible ranking.
                "kind": "initial_formation" if not events else scheduled_event["kind"],
                "selected": selected,
                "weights": target_weights,
            }
        )

    if not events:
        return {"available": False, "reason": "no rebalance produced an eligible ranking"}

    nav = 100.0
    nav_dates: list[pd.Timestamp] = []
    nav_values: list[float] = []
    price_nav = 100.0
    price_nav_values: list[float] = []
    holdings_log: list[dict] = []
    holdings: dict[str, float] = {}
    previous_prices: dict[str, float] = {}
    price_holdings: dict[str, float] = {}
    price_previous_prices: dict[str, float] = {}
    price_cash = 0.0
    total_cost = 0.0
    total_price_cost = 0.0
    total_one_way_turnover = 0.0
    effective_end_position = (
        int(prices.index.searchsorted(pd.Timestamp(end), side="right"))
        if end is not None
        else len(prices.index)
    )

    for event_index, event in enumerate(events):
        start_position = event["execution_position"]
        end_position = (
            events[event_index + 1]["execution_position"]
            if event_index + 1 < len(events)
            else effective_end_position
        )
        start = prices.index[start_position]
        targets = event["selected"]

        if not holdings:
            nav_before = nav
            trade_notional = nav_before
            one_way_turnover = 1.0
            price_nav_before = price_nav
            price_trade_notional = price_nav_before
        else:
            nav_before = _mark_to_market(holdings, previous_prices, prices, start)
            price_nav_before = _mark_cash_dividend_account(
                price_holdings,
                price_previous_prices,
                price_prices,
                price_dividends,
                start,
                price_cash,
            )
            target_values = {
                symbol: nav_before * (event["weights"][symbol] / 100.0)
                for symbol in targets
            }
            all_symbols = set(holdings) | set(targets)
            trade_notional = sum(
                abs(target_values.get(symbol, 0.0) - holdings.get(symbol, 0.0))
                for symbol in all_symbols
            )
            one_way_turnover = trade_notional / (2.0 * nav_before) if nav_before > 0 else 0.0
            price_target_values = {
                symbol: (price_nav_before - price_cash) * (event["weights"][symbol] / 100.0)
                for symbol in targets
            }
            price_trade_notional = sum(
                abs(price_target_values.get(symbol, 0.0) - price_holdings.get(symbol, 0.0))
                for symbol in set(price_holdings) | set(targets)
            ) + price_cash

        cost = trade_notional * (transaction_cost_rate + slippage_rate)
        price_cost = price_trade_notional * (transaction_cost_rate + slippage_rate)
        nav_after_trade = max(0.0, nav_before - cost)
        price_nav_after_trade = max(0.0, price_nav_before - price_cost)
        nav = nav_after_trade
        price_nav = price_nav_after_trade
        holdings = {
            symbol: nav_after_trade * (event["weights"][symbol] / 100.0)
            for symbol in targets
        }
        price_holdings = {
            symbol: price_nav_after_trade * (event["weights"][symbol] / 100.0)
            for symbol in targets
        }
        price_cash = 0.0
        previous_prices = {
            symbol: float(prices.at[start, symbol])
            for symbol in targets
            if symbol in prices.columns and pd.notna(prices.at[start, symbol])
        }
        price_previous_prices = {
            symbol: float(price_prices.at[start, symbol])
            for symbol in targets
            if symbol in price_prices.columns and pd.notna(price_prices.at[start, symbol])
        }

        nav_dates.append(start)
        nav_values.append(nav)
        price_nav_values.append(price_nav)
        total_cost += cost
        total_price_cost += price_cost
        total_one_way_turnover += one_way_turnover
        holdings_log.append(
            {
                "signal_date": prices.index[event["signal_position"]].strftime("%Y-%m-%d"),
                "execution_date": start.strftime("%Y-%m-%d"),
                "type": event["kind"],
                "count": len(targets),
                "leaders": targets[:5],
                "holdings": {
                    symbol: round(event["weights"][symbol], 4)
                    for symbol in targets
                },
                "turnover_pct": round(one_way_turnover * 100.0, 2),
                "cost_usd": round(cost, 4),
            }
        )

        for position in range(start_position + 1, end_position):
            stamp = prices.index[position]
            nav = _mark_to_market(holdings, previous_prices, prices, stamp)
            price_nav = _mark_cash_dividend_account(
                price_holdings,
                price_previous_prices,
                price_prices,
                price_dividends,
                stamp,
                price_cash,
            )
            price_cash = price_nav - sum(price_holdings.values())
            nav_dates.append(stamp)
            nav_values.append(nav)
            price_nav_values.append(price_nav)

    if len(nav_values) < 20:
        return {"available": False, "reason": "not enough post-rebalance observations"}

    strategy = pd.Series(nav_values, index=pd.DatetimeIndex(nav_dates)).sort_index()
    strategy = strategy[~strategy.index.duplicated(keep="last")]
    price_strategy = pd.Series(price_nav_values, index=pd.DatetimeIndex(nav_dates)).sort_index()
    price_strategy = price_strategy[~price_strategy.index.duplicated(keep="last")]
    benchmark_series = {}
    price_benchmark_series = {}
    for symbol in benchmark_symbols:
        series = series_map.get(symbol)
        if series is None or series.rows < 60:
            continue
        closes = series.frame["adj"].loc[
            (series.frame.index >= strategy.index[0]) & (series.frame.index <= strategy.index[-1])
        ]
        if not closes.empty:
            benchmark_series[symbol] = closes / closes.iloc[0] * 100.0
            cash_values = _cash_dividend_benchmark(series).loc[
                (series.frame.index >= strategy.index[0])
                & (series.frame.index <= strategy.index[-1])
            ]
            if not cash_values.empty:
                price_benchmark_series[symbol] = cash_values / cash_values.iloc[0] * 100.0

    checked_symbols = sorted(set(candidates) | {symbol for symbol in benchmark_symbols if symbol in series_map})
    verified_sources = {"yahoo", "fmp"}
    affected = [
        symbol
        for symbol in checked_symbols
        if series_map[symbol].source not in verified_sources
    ]
    dividend_coverage = {
        "securities_checked": len(checked_symbols),
        "verified_securities": len(checked_symbols) - len(affected),
        "incomplete_securities": len(affected),
        "affected_tickers": affected,
        "affected_dates": [],
        "source": sorted({series_map[symbol].source for symbol in checked_symbols}),
        "verified_action_fields": ["dividends", "stock_splits"],
        "convention": (
            "Total return uses adjusted closes. Dividend-exclusive return uses "
            "split-adjusted closes, retains cash on each ex-date, and does not "
            "purchase additional shares."
        ),
    }

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
    event_counts = {
        "initial_formation": sum(event["type"] == "initial_formation" for event in holdings_log),
        "scheduled": sum(event["type"] == "scheduled" for event in holdings_log),
        "total": len(holdings_log),
    }

    return {
        "available": True,
        "start": strategy.index[0].strftime("%Y-%m-%d"),
        "end": strategy.index[-1].strftime("%Y-%m-%d"),
        "strategy": strategy,
        "price_strategy": price_strategy,
        "benchmarks": benchmark_series,
        "price_benchmarks": price_benchmark_series,
        "drawdown": drawdown,
        "monthly": monthly,
        "monthly_benchmarks": monthly_benchmarks,
        "annual": annual,
        "holdings_log": holdings_log,
        "event_counts": event_counts,
        "methodology": {
            "selection": f"top {top_n}" if top_n is not None else "all eligible stocks",
            "rebalance_frequency": rebalance_frequency,
            "rebalance_months": list(sorted(rebalance_set)),
            "initial_formation": events[0]["kind"] == "initial_formation",
            "weighting": (
                "equal-start weights with 9% stock and 35% sector caps"
                if sector_by_symbol
                else "equal weight (research proxy; sector caps unavailable)"
            ),
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
            "price_only_transaction_cost_pct": round(total_price_cost, 4),
            "total_one_way_turnover_pct": round(total_one_way_turnover * 100.0, 1),
            "annualized_one_way_turnover_pct": round(total_one_way_turnover / years * 100.0, 1),
        },
        "dividend_coverage": dividend_coverage,
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

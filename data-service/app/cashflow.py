"""External cash-flow simulation for strategy and benchmark accounts.

The backtest NAV is a total-return wealth index per unit of capital. External
deposits buy units at the close and withdrawals redeem units at the close. This
keeps every account fully invested while preserving the strategy's current
allocation. Time-weighted return is measured from the underlying NAV path;
money-weighted return is solved from dated investor cash flows.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date
from typing import Iterable

import pandas as pd

SUPPORTED_FREQUENCIES = {"monthly", "quarterly", "annual", "annually"}


def normalize_frequency(value: str | None) -> str:
    frequency = str(value or "monthly").strip().lower()
    if frequency not in SUPPORTED_FREQUENCIES:
        raise ValueError(f"unsupported cashflow frequency: {value}")
    return "annual" if frequency == "annually" else frequency


def _date_string(value) -> str:
    return value.strftime("%Y-%m-%d") if hasattr(value, "strftime") else str(value)[:10]


def _period_key(value, frequency: str) -> str:
    stamp = pd.Timestamp(value)
    if frequency == "monthly":
        return stamp.strftime("%Y-%m")
    if frequency == "quarterly":
        return f"{stamp.year}-Q{stamp.quarter}"
    return str(stamp.year)


def cashflow_schedule(
    dates: Iterable,
    *,
    enabled: bool,
    amount: float,
    frequency: str,
) -> list[dict]:
    """Return identical requested external-flow events for every account."""
    normalized_dates = [_date_string(value) for value in dates]
    frequency = normalize_frequency(frequency)
    if not enabled or amount <= 0 or len(normalized_dates) < 2:
        return []
    events = []
    for index in range(1, len(normalized_dates)):
        if (
            _period_key(normalized_dates[index], frequency)
            != _period_key(normalized_dates[index - 1], frequency)
        ):
            events.append(
                {
                    "index": index,
                    "date": normalized_dates[index],
                    "requested_amount": float(amount),
                }
            )
    return events


def calculate_xirr(cashflows: Iterable[dict]) -> float | None:
    """Solve annualized XIRR from investor cash flows using bisection."""
    grouped: dict[str, float] = defaultdict(float)
    for flow in cashflows:
        stamp = str(flow.get("date") or "")[:10]
        amount = flow.get("amount")
        if stamp and isinstance(amount, (int, float)) and math.isfinite(float(amount)):
            grouped[stamp] += float(amount)
    dated = sorted(grouped.items())
    if (
        len(dated) < 2
        or not any(amount < 0 for _, amount in dated)
        or not any(amount > 0 for _, amount in dated)
    ):
        return None

    origin = date.fromisoformat(dated[0][0])

    def npv(rate: float) -> float:
        total = 0.0
        for stamp, amount in dated:
            years = (date.fromisoformat(stamp) - origin).days / 365.0
            total += amount / ((1.0 + rate) ** years)
        return total

    low = -0.9999
    high = 10.0
    low_value = npv(low)
    high_value = npv(high)
    expansion = 0
    while math.copysign(1.0, low_value) == math.copysign(1.0, high_value) and expansion < 8:
        high *= 10.0
        high_value = npv(high)
        expansion += 1
    if math.copysign(1.0, low_value) == math.copysign(1.0, high_value):
        return None

    for _ in range(200):
        middle = (low + high) / 2.0
        middle_value = npv(middle)
        if abs(middle_value) < 1e-8:
            return middle * 100.0
        if math.copysign(1.0, middle_value) == math.copysign(1.0, low_value):
            low = middle
            low_value = middle_value
        else:
            high = middle
            high_value = middle_value
    return ((low + high) / 2.0) * 100.0


def simulate_account(
    dates: Iterable,
    nav_values: Iterable,
    *,
    initial_capital: float,
    cashflow_enabled: bool = False,
    cashflow_amount: float = 0.0,
    cashflow_frequency: str = "monthly",
    cashflow_direction: str = "inflow",
    twr_origin: float | None = None,
    manual_events: list[dict] | None = None,
) -> dict:
    """Simulate one fully invested account with fractional units.

    Returns never use account balances. They are always the linked underlying
    NAV return, so external deposits and withdrawals cannot create performance.
    """
    stamps = [_date_string(value) for value in dates]
    values = [float(value) for value in nav_values]
    if len(stamps) < 2 or len(stamps) != len(values):
        raise ValueError("dates and nav_values must contain the same at least two observations")
    if not isinstance(initial_capital, (int, float)) or not math.isfinite(initial_capital) or initial_capital <= 0:
        raise ValueError("initial_capital must be a finite positive number")
    direction = "outflow" if cashflow_direction == "outflow" else "inflow"
    frequency = normalize_frequency(cashflow_frequency)
    amount = float(cashflow_amount) if isinstance(cashflow_amount, (int, float)) else 0.0
    if not math.isfinite(amount) or amount < 0:
        raise ValueError("cashflow_amount must be a finite non-negative number")
    if manual_events is None:
        requested = cashflow_schedule(
            stamps,
            enabled=cashflow_enabled,
            amount=amount,
            frequency=frequency,
        )
    else:
        requested = []
        for event in manual_events:
            index = int(event.get("index", -1))
            if index <= 0 or index >= len(stamps):
                raise ValueError("manual cashflow event index is outside the timeline")
            event_amount = float(event.get("amount", 0.0))
            if not math.isfinite(event_amount) or event_amount <= 0:
                raise ValueError("manual cashflow amounts must be finite and positive")
            requested.append(
                {
                    "index": index,
                    "date": stamps[index],
                    "requested_amount": event_amount,
                    "direction": (
                        "outflow"
                        if event.get("direction") == "outflow"
                        else "inflow"
                    ),
                }
            )
    events_by_index = {event["index"]: event for event in requested}

    origin = float(twr_origin) if isinstance(twr_origin, (int, float)) else values[0]
    if not math.isfinite(origin) or origin <= 0:
        origin = None

    initial_nav = values[0]
    if not math.isfinite(initial_nav) or initial_nav <= 0:
        units = 0.0
        cash = 0.0
    else:
        units = float(initial_capital) / origin if origin is not None else 0.0
        cash = 0.0

    balances: list[float] = []
    holdings_values: list[float] = []
    cash_values: list[float] = []
    units_values: list[float] = []
    twr_values: list[float] = []
    events: list[dict] = []
    investor_flows = [{"date": stamps[0], "amount": -float(initial_capital)}]
    total_inflows = 0.0
    requested_outflows = 0.0
    actual_outflows = 0.0
    unpaid_outflows = 0.0

    for index, (stamp, nav_value) in enumerate(zip(stamps, values)):
        nav = float(nav_value)
        if index:
            # Units of the total-return wealth index stay constant through
            # market moves; the NAV already contains the investment return.
            if not math.isfinite(nav) or nav <= 0:
                units = 0.0

        holdings = max(0.0, units * nav) if math.isfinite(nav) and nav > 0 else 0.0
        if holdings <= 0:
            units = 0.0
        cash = max(0.0, cash)
        balance = holdings + cash
        event = events_by_index.get(index)
        if event:
            balance_before = balance
            scheduled = event["requested_amount"]
            event_direction = event.get("direction", direction)
            if event_direction == "inflow":
                actual = scheduled
                if math.isfinite(nav) and nav > 0:
                    units += actual / nav
                else:
                    cash += actual
                total_inflows += actual
                investor_flows.append({"date": stamp, "amount": -actual})
                unpaid = 0.0
            else:
                requested_outflows += scheduled
                actual = min(scheduled, balance)
                unpaid = scheduled - actual
                cash_used = min(cash, actual)
                cash -= cash_used
                remaining = actual - cash_used
                if remaining > 0 and math.isfinite(nav) and nav > 0:
                    units = max(0.0, units - remaining / nav)
                actual_outflows += actual
                unpaid_outflows += unpaid
                investor_flows.append({"date": stamp, "amount": actual})
            holdings = max(0.0, units * nav) if math.isfinite(nav) and nav > 0 else 0.0
            balance = max(0.0, holdings + cash)
            if balance <= 1e-9:
                units = 0.0
                cash = 0.0
                balance = 0.0
            events.append(
                {
                    "date": stamp,
                    "direction": event_direction,
                    "requested_amount": scheduled,
                    "actual_amount": actual,
                    "unpaid_amount": unpaid,
                    "balance_before": balance_before,
                    "balance_after": balance,
                    "units": units,
                    "available_cash": cash,
                }
            )

        cumulative_twr = (
            (nav / origin - 1.0) * 100.0
            if origin is not None and math.isfinite(nav) and nav >= 0
            else None
        )
        balances.append(balance)
        holdings_values.append(holdings)
        cash_values.append(cash)
        units_values.append(units)
        twr_values.append(cumulative_twr)

    ending_balance = balances[-1]
    investor_flows.append({"date": stamps[-1], "amount": ending_balance})
    daily_twr = [
        (values[index] / values[index - 1] - 1.0) * 100.0
        for index in range(1, len(values))
        if values[index - 1] > 0 and values[index] >= 0
    ]
    gross_invested = float(initial_capital) + total_inflows
    return {
        "initial_capital": float(initial_capital),
        "final_value": ending_balance,
        "ending_holdings_value": holdings_values[-1],
        "ending_cash": cash_values[-1],
        "remaining_units": units_values[-1],
        "total_inflows": total_inflows,
        "requested_outflows": requested_outflows,
        "actual_outflows": actual_outflows,
        "unpaid_outflows": unpaid_outflows,
        "net_cashflow": total_inflows - actual_outflows,
        "gross_invested_capital": gross_invested,
        "net_profit_loss": ending_balance + actual_outflows - gross_invested,
        "time_weighted_return_pct": twr_values[-1],
        "money_weighted_return_pct": calculate_xirr(investor_flows),
        "balances": balances,
        "holdings_values": holdings_values,
        "cash_values": cash_values,
        "units": units_values,
        "twr_values": twr_values,
        "daily_returns": daily_twr,
        "events": events,
        "investor_flows": investor_flows,
        "cashflow_direction": (
            "mixed"
            if manual_events is not None
            and len({event.get("direction", direction) for event in requested}) > 1
            else direction
        ),
        "cashflow_frequency": frequency,
    }


def simulate_accounts(
    dates: Iterable,
    strategy: Iterable,
    benchmarks: dict[str, Iterable],
    *,
    initial_capital: float,
    cashflow_enabled: bool,
    cashflow_amount: float,
    cashflow_frequency: str,
    cashflow_direction: str,
) -> dict:
    """Simulate Strategy, SPY and SPMO from the same requested schedule."""
    stamps = list(dates)
    accounts = {
        "strategy": simulate_account(
            stamps,
            strategy,
            initial_capital=initial_capital,
            cashflow_enabled=cashflow_enabled,
            cashflow_amount=cashflow_amount,
            cashflow_frequency=cashflow_frequency,
            cashflow_direction=cashflow_direction,
            twr_origin=100.0,
        )
    }
    for symbol, values in benchmarks.items():
        benchmark_values = list(values)
        account = simulate_account(
            stamps,
            benchmark_values,
            initial_capital=initial_capital,
            cashflow_enabled=cashflow_enabled,
            cashflow_amount=cashflow_amount,
            cashflow_frequency=cashflow_frequency,
            cashflow_direction=cashflow_direction,
            twr_origin=float(benchmark_values[0]) if benchmark_values else None,
        )
        accounts[symbol.lower()] = account
    return {
        "config": {
            "initial_capital": float(initial_capital),
            "enabled": bool(cashflow_enabled),
            "amount": float(cashflow_amount),
            "frequency": normalize_frequency(cashflow_frequency),
            "direction": "outflow" if cashflow_direction == "outflow" else "inflow",
        },
        "accounts": accounts,
    }

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
    cumulative_inflows: list[float] = []
    cumulative_outflows: list[float] = []

    for index, (stamp, nav_value) in enumerate(zip(stamps, values)):
        nav = float(nav_value)
        usable = math.isfinite(nav) and nav > 0
        if index and not usable:
            # Units of the total-return wealth index stay constant through
            # market moves; the NAV already contains the investment return.
            # An unusable close makes the holding worthless rather than leaving
            # stale units that would reappear on the next valid observation.
            units = 0.0
        if cash > 0 and usable:
            # Cash received while no usable close existed is invested at the
            # first usable close, so it never earns the return it missed. This
            # is the only way an account holds cash, and it is why a later
            # inflow can restart investment after a depletion.
            units += cash / nav
            cash = 0.0

        holdings = max(0.0, units * nav) if usable else 0.0
        if holdings <= 0:
            units = 0.0
        cash = max(0.0, cash)
        balance = holdings + cash
        event = events_by_index.get(index)
        # A depleted account has nothing left to redeem. Re-requesting the
        # withdrawal every period would accumulate an "unpaid" figure that never
        # had a chance of being paid, so the schedule stops for outflows while
        # the account is closed. A later inflow still revives it.
        skip_event = bool(
            event
            and (event.get("direction", direction) == "outflow")
            and balance <= 1e-9
        )
        if event and not skip_event:
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
        cumulative_inflows.append(total_inflows)
        cumulative_outflows.append(actual_outflows)

    ending_balance = balances[-1]
    investor_flows.append({"date": stamps[-1], "amount": ending_balance})
    daily_twr = [
        (values[index] / values[index - 1] - 1.0) * 100.0
        for index in range(1, len(values))
        if values[index - 1] > 0 and values[index] >= 0
    ]
    # Account-balance drawdown is a separate measurement from the unitized-NAV
    # (investment) drawdown: it follows the money the investor actually owns, so
    # an executed withdrawal shows up here as a fall in the balance even though
    # it is not an investment loss.
    # Return on capital is the money-weighted *level* the investor sees: profit
    # measured against everything they have put in so far. It responds to every
    # deposit and withdrawal, which the unitized TWR deliberately does not.
    capital_return: list[float | None] = []
    for index, balance in enumerate(balances):
        invested = float(initial_capital) + cumulative_inflows[index]
        profit = (
            balance
            + cumulative_outflows[index]
            - cumulative_inflows[index]
            - float(initial_capital)
        )
        capital_return.append(profit / invested * 100.0 if invested > 0 else None)

    running_peak = 0.0
    balance_drawdown: list[float] = []
    for balance in balances:
        running_peak = max(running_peak, balance)
        balance_drawdown.append(
            (balance / running_peak - 1.0) * 100.0 if running_peak > 0 else 0.0
        )
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
        "capital_return": capital_return,
        "ending_capital_return_pct": capital_return[-1] if capital_return else None,
        # A closed account has no ongoing return to report. The page shows N/A
        # for its account-level return, while TWR and XIRR stay available.
        "fully_depleted": bool(
            ending_balance <= 1e-9 and units_values[-1] <= 1e-9
        ),
        "balance_drawdown": balance_drawdown,
        "max_balance_drawdown_pct": min(balance_drawdown) if balance_drawdown else 0.0,
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


AUDIT_TOLERANCE = 1e-6


def audit_account(result: dict, dates: Iterable | None = None) -> list[str]:
    """Verify the accounting identities one simulated account must satisfy.

    Returns human-readable violations; an empty list means the account is
    internally consistent. The test suite calls this for every scenario so a
    regression in the simulation cannot ship silently. ``dates`` is optional and
    only used to cross-check each cash-flow event against the timeline.
    """
    problems: list[str] = []

    def numeric(name: str) -> list[float]:
        series = result.get(name)
        if not isinstance(series, list) or not series:
            problems.append(f"{name} is missing or empty")
            return []
        cleaned: list[float] = []
        for index, value in enumerate(series):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                problems.append(f"{name}[{index}] is not numeric: {value!r}")
                cleaned.append(0.0)
            elif not math.isfinite(float(value)):
                problems.append(f"{name}[{index}] is not finite: {value!r}")
                cleaned.append(0.0)
            else:
                cleaned.append(float(value))
        return cleaned

    balances = numeric("balances")
    holdings = numeric("holdings_values")
    cash = numeric("cash_values")
    units = numeric("units")
    if not balances:
        return problems

    for name, series in (
        ("holdings_values", holdings),
        ("cash_values", cash),
        ("units", units),
    ):
        if len(series) != len(balances):
            problems.append(
                f"{name} has {len(series)} observations but balances has {len(balances)}"
            )

    for label, series in (
        ("balance", balances),
        ("holdings", holdings),
        ("cash", cash),
    ):
        for index, value in enumerate(series):
            if value < -AUDIT_TOLERANCE:
                problems.append(f"{label}[{index}] is negative: {value!r}")
    for index, value in enumerate(units):
        if value < -AUDIT_TOLERANCE:
            problems.append(f"units[{index}] is negative: {value!r}")

    pair_count = min(len(balances), len(holdings), len(cash))
    for index in range(pair_count):
        if abs(balances[index] - (holdings[index] + cash[index])) > AUDIT_TOLERANCE:
            problems.append(
                f"balance[{index}] {balances[index]!r} != holdings + cash "
                f"{holdings[index] + cash[index]!r}"
            )

    ending_balance = balances[-1]
    if abs(float(result.get("final_value", math.nan)) - ending_balance) > AUDIT_TOLERANCE:
        problems.append("final_value does not equal the last balance")
    if abs(float(result.get("ending_holdings_value", math.nan)) - holdings[-1]) > AUDIT_TOLERANCE:
        problems.append("ending_holdings_value does not equal the last holdings value")
    if abs(float(result.get("ending_cash", math.nan)) - cash[-1]) > AUDIT_TOLERANCE:
        problems.append("ending_cash does not equal the last cash value")

    initial_capital = float(result.get("initial_capital", 0.0))
    total_inflows = float(result.get("total_inflows", 0.0))
    actual_outflows = float(result.get("actual_outflows", 0.0))
    gross_invested = initial_capital + total_inflows
    if abs(float(result.get("gross_invested_capital", math.nan)) - gross_invested) > AUDIT_TOLERANCE:
        problems.append("gross_invested_capital != initial capital + total inflows")
    expected_profit = ending_balance + actual_outflows - gross_invested
    if abs(float(result.get("net_profit_loss", math.nan)) - expected_profit) > AUDIT_TOLERANCE:
        problems.append(
            "net_profit_loss != ending balance + actual outflows - initial capital - inflows"
        )

    date_index = {
        _date_string(value): index for index, value in enumerate(dates or [])
    }
    for event in result.get("events") or []:
        requested = float(event.get("requested_amount", 0.0))
        actual = float(event.get("actual_amount", 0.0))
        unpaid = float(event.get("unpaid_amount", 0.0))
        before = float(event.get("balance_before", 0.0))
        after = float(event.get("balance_after", 0.0))
        direction = "outflow" if event.get("direction") == "outflow" else "inflow"
        if actual < -AUDIT_TOLERANCE:
            problems.append(f"{event.get('date')}: executed amount is negative")
        if unpaid < -AUDIT_TOLERANCE:
            problems.append(f"{event.get('date')}: unpaid amount is negative")
        if abs((actual + unpaid) - requested) > AUDIT_TOLERANCE:
            problems.append(f"{event.get('date')}: actual + unpaid != requested")
        if actual > before + AUDIT_TOLERANCE and direction == "outflow":
            problems.append(f"{event.get('date')}: executed more than the available balance")
        if after < -AUDIT_TOLERANCE:
            problems.append(f"{event.get('date')}: balance after the event is negative")
        expected_after = (
            max(0.0, before - actual) if direction == "outflow" else before + actual
        )
        if abs(after - expected_after) > AUDIT_TOLERANCE:
            problems.append(f"{event.get('date')}: balance after != expected post-event balance")
        index = date_index.get(str(event.get("date"))[:10])
        if index is not None and abs(balances[index] - after) > AUDIT_TOLERANCE:
            problems.append(f"{event.get('date')}: event balance does not match the timeline")
        if direction == "inflow" and unpaid > AUDIT_TOLERANCE:
            problems.append(f"{event.get('date')}: an inflow cannot be unpaid")

    for name in ("time_weighted_return_pct", "money_weighted_return_pct"):
        value = result.get(name)
        if value is not None and not math.isfinite(float(value)):
            problems.append(f"{name} is not finite: {value!r}")

    return problems


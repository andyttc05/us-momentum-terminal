"""Validation and serialisation for on-demand backtest jobs.

A custom-date backtest can be requested from two places: the local FastAPI
service and the Cloudflare Worker that dispatches a GitHub Actions run. Both
must apply exactly the same rules, otherwise a job that the browser accepted
would be rejected by the runner (or worse, run with different semantics). This
module is the single source of truth for that contract; it never performs a
quantitative calculation itself.
"""

from __future__ import annotations

import math
from datetime import date

from .backtest import REBALANCE_FREQUENCIES, REBALANCE_LABELS
from .cashflow import normalize_frequency as normalize_cashflow_frequency

PORTFOLIOS = ("top100", "top20")
CASHFLOW_DIRECTIONS = ("inflow", "outflow")

# Bounds that keep a single request inside the free-tier execution budget and
# reject values that cannot represent a portfolio.
MAX_CAPITAL = 1_000_000_000.0
MAX_CASHFLOW_AMOUNT = 1_000_000_000.0
MAX_SPAN_DAYS = 40 * 366


class ConfigError(ValueError):
    """A request the engine must not run, with a stable machine code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _number(payload: dict, key: str, default: float) -> float:
    value = payload.get(key, default)
    if isinstance(value, bool) or value is None:
        raise ConfigError(f"invalid_{key}", f"{key} must be a number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"invalid_{key}", f"{key} must be a number") from exc
    if not math.isfinite(number):
        raise ConfigError(f"invalid_{key}", f"{key} must be a finite number")
    return number


def _iso_date(payload: dict, key: str) -> date:
    text = str(payload.get(key, "")).strip()
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise ConfigError(f"invalid_{key}", f"{key} must use YYYY-MM-DD") from exc


def normalize_config(payload: dict | None) -> dict:
    """Return the engine arguments for one validated request.

    Raises ``ConfigError`` with a stable code so the caller can answer 400
    without leaking a stack trace or an internal message.
    """
    if not isinstance(payload, dict):
        raise ConfigError("invalid_config", "config must be an object")

    portfolio = str(payload.get("portfolio", "top100")).strip().lower()
    if portfolio not in PORTFOLIOS:
        raise ConfigError("invalid_portfolio", "portfolio must be top100 or top20")

    frequency = str(payload.get("rebalance_frequency", "semiannual")).strip().lower()
    if frequency not in REBALANCE_FREQUENCIES:
        raise ConfigError(
            "invalid_rebalance_frequency",
            f"rebalance_frequency must be one of: {', '.join(REBALANCE_FREQUENCIES)}",
        )

    start = _iso_date(payload, "start")
    end = _iso_date(payload, "end")
    if start >= end:
        raise ConfigError("invalid_range", "end must be after start")
    if (end - start).days > MAX_SPAN_DAYS:
        raise ConfigError("range_too_long", "the window is longer than the supported history")

    initial_capital = _number(payload, "initial_capital", 10_000.0)
    if initial_capital <= 0 or initial_capital > MAX_CAPITAL:
        raise ConfigError("invalid_initial_capital", "initial_capital must be greater than zero")

    cashflow_enabled = payload.get("cashflow_enabled", False)
    if not isinstance(cashflow_enabled, bool):
        raise ConfigError("invalid_cashflow_enabled", "cashflow_enabled must be a boolean")

    cashflow_amount = _number(payload, "cashflow_amount", 0.0)
    if cashflow_amount < 0 or cashflow_amount > MAX_CASHFLOW_AMOUNT:
        raise ConfigError("invalid_cashflow_amount", "cashflow_amount must be finite and non-negative")
    if cashflow_enabled and cashflow_amount <= 0:
        raise ConfigError(
            "invalid_cashflow_amount",
            "cashflow_amount must be greater than zero when cashflows are enabled",
        )

    try:
        cashflow_frequency = normalize_cashflow_frequency(payload.get("cashflow_frequency", "monthly"))
    except ValueError as exc:
        raise ConfigError("invalid_cashflow_frequency", str(exc)) from exc

    cashflow_direction = str(payload.get("cashflow_direction", "inflow")).strip().lower()
    if cashflow_direction not in CASHFLOW_DIRECTIONS:
        raise ConfigError("invalid_cashflow_direction", "cashflow_direction must be inflow or outflow")

    return {
        "portfolio": portfolio,
        "rebalance_frequency": frequency,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "initial_capital": initial_capital,
        "cashflow_enabled": cashflow_enabled,
        "cashflow_amount": cashflow_amount,
        "cashflow_frequency": cashflow_frequency,
        "cashflow_direction": cashflow_direction,
    }


def config_summary(config: dict) -> dict:
    """The non-sensitive echo stored beside a job and shown to the client."""
    return {
        "portfolio": config["portfolio"],
        "rebalanceFrequency": config["rebalance_frequency"],
        "start": config["start"],
        "end": config["end"],
        "initialCapital": config["initial_capital"],
        "cashflowEnabled": config["cashflow_enabled"],
        "cashflowAmount": config["cashflow_amount"],
        "cashflowFrequency": config["cashflow_frequency"],
        "cashflowDirection": config["cashflow_direction"],
        "rebalanceLabel": REBALANCE_LABELS[config["rebalance_frequency"]],
    }


def run_custom_backtest(config: dict) -> dict:
    """Execute one validated request with the existing production engine."""
    from .snapshot import run_historical_backtest

    result = run_historical_backtest(
        portfolio=config["portfolio"],
        rebalance_frequency=config["rebalance_frequency"],
        start=config["start"],
        end=config["end"],
        initial_capital=config["initial_capital"],
        cashflow_enabled=config["cashflow_enabled"],
        cashflow_amount=config["cashflow_amount"],
        cashflow_frequency=config["cashflow_frequency"],
        cashflow_direction=config["cashflow_direction"],
    )
    result["rebalanceLabel"] = REBALANCE_LABELS[config["rebalance_frequency"]]
    return result


def validate_result(result: dict) -> None:
    """Reject a payload the dashboard could not render before it is stored."""
    if not isinstance(result, dict):
        raise ConfigError("invalid_result", "result must be an object")
    if result.get("available") is not True:
        # An unavailable engine result is a legitimate answer for the client,
        # but it must carry a reason rather than a silently empty block.
        if not str(result.get("reason") or "").strip():
            raise ConfigError("invalid_result", "an unavailable result must include a reason")
        return
    dates = result.get("dates")
    strategy = result.get("strategy")
    if not isinstance(dates, list) or not isinstance(strategy, list) or not dates:
        raise ConfigError("invalid_result", "result is missing its date or strategy series")
    if len(dates) != len(strategy):
        raise ConfigError("invalid_result", "date and strategy lengths differ")
    for key in ("drawdown", "spy", "spmo"):
        series = result.get(key)
        if series and (not isinstance(series, list) or len(series) != len(dates)):
            raise ConfigError("invalid_result", f"{key} does not align with the date axis")
    if not isinstance(result.get("metrics"), dict):
        raise ConfigError("invalid_result", "result is missing its metrics block")

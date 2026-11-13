"""Model portfolio construction and constraint enforcement.

Selection is the requested number of highest-ranked eligible names. Raw weights
are proportional to ``float-adjusted market cap x momentum score``. A
proportional redistribution finds the allocation that satisfies both the
individual-name and sector caps while remaining fully invested. If the
constraints are infeasible, the function reports that state and does not publish
an invalid book.
"""

from __future__ import annotations

import math

SINGLE_NAME_CAP = 9.0
SECTOR_CAP = 35.0
TARGET_HOLDINGS = 100
SUPPORTED_HOLDING_COUNTS = (20, 100)
WEIGHT_TOTAL_TOLERANCE = 0.01
CAP_ROUNDING_TOLERANCE = 1e-5

SECTOR_GROUPS = {
    "Technology": "Technology",
    "Communication": "Communication",
    "Healthcare": "Healthcare",
    "Consumer Discretionary": "Consumer",
    "Consumer Staples": "Consumer",
    "Industrials": "Industrials",
    "Financials": "Others",
    "Energy": "Others",
    "Materials": "Others",
    "Utilities": "Others",
    "Real Estate": "Others",
}

SECTOR_COLORS = {
    "Technology": "var(--color-yellow)",
    "Communication": "var(--color-pink)",
    "Healthcare": "var(--color-blue)",
    "Consumer Discretionary": "var(--color-mint)",
    "Consumer Staples": "var(--color-sector-consumer-staples)",
    "Industrials": "var(--color-lavender)",
    "Financials": "var(--color-sector-financials)",
    "Energy": "var(--color-sector-energy)",
    "Materials": "var(--color-sector-materials)",
    "Utilities": "var(--color-sector-utilities)",
    "Real Estate": "var(--color-sector-real-estate)",
    "Other": "var(--color-sector-other)",
    "Others": "var(--color-sector-other)",
}

SECTOR_DISPLAY_ORDER = tuple(
    sector for sector in SECTOR_COLORS if sector not in {"Other", "Others"}
)


def group_sector(sector: str) -> str:
    return SECTOR_GROUPS.get(sector, "Others")


def constraint_definitions(target_holdings: int = TARGET_HOLDINGS) -> tuple[tuple[str, str, str], ...]:
    return (
        ("max-stock", "Max Stock Weight", "≤ 9%"),
        ("max-sector", "Max Sector Weight", "≤ 35%"),
        ("target-holdings", "Target Holdings", f"= {target_holdings}"),
        ("target-allocation", "Target Allocation", "= 100%"),
    )


def evaluate_portfolio_constraints(
    holdings: list[dict],
    target_holdings: int = TARGET_HOLDINGS,
) -> tuple[list[dict], dict]:
    """Validate the four published constraints from the final holdings.

    Missing or invalid weights are never treated as a pass. The returned rules
    stay in canonical display order even when the portfolio cannot be evaluated.
    """
    definitions = constraint_definitions(target_holdings)
    weights = [holding.get("finalWeight") for holding in holdings]
    evaluable = bool(holdings) and all(
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
        for value in weights
    )

    if not evaluable:
        constraints = [
            {
                "id": constraint_id,
                "label": label,
                "rule": rule,
                "passed": False,
                "status": "unavailable",
            }
            for constraint_id, label, rule in definitions
        ]
        return constraints, {
            "evaluated": False,
            "holdingCount": len(holdings),
            "totalFinalWeight": None,
            "maximumHoldingWeight": None,
            "maximumSectorWeight": None,
            "sectorsAtOrBelowCap": False,
            "topTenWeight": None,
        }

    total_weight = sum(weights)
    maximum_holding = max(weights)
    sector_totals: dict[str, float] = {}
    for holding, weight in zip(holdings, weights):
        sector = str(holding.get("sector") or "Other")
        sector_totals[sector] = sector_totals.get(sector, 0.0) + weight
    maximum_sector = max(sector_totals.values())
    passed_by_id = {
        "max-stock": maximum_holding <= SINGLE_NAME_CAP + CAP_ROUNDING_TOLERANCE,
        "max-sector": maximum_sector <= SECTOR_CAP + CAP_ROUNDING_TOLERANCE,
        "target-holdings": len(holdings) == target_holdings,
        "target-allocation": abs(total_weight - 100.0) <= WEIGHT_TOTAL_TOLERANCE,
    }
    constraints = [
        {
            "id": constraint_id,
            "label": label,
            "rule": rule,
            "passed": passed_by_id[constraint_id],
            "status": "passed" if passed_by_id[constraint_id] else "failed",
        }
        for constraint_id, label, rule in definitions
    ]
    top_ten = sum(sorted(weights, reverse=True)[:10])
    return constraints, {
        "evaluated": True,
        "holdingCount": len(holdings),
        "totalFinalWeight": round(total_weight, 2),
        "maximumHoldingWeight": maximum_holding,
        "maximumSectorWeight": round(maximum_sector, 4),
        "sectorsAtOrBelowCap": passed_by_id["max-sector"],
        "topTenWeight": round(top_ten, 1),
    }


def _rounded_sector_values(totals: dict[str, float], target: float = 100.0) -> dict[str, float]:
    """Round sector totals to tenths while preserving their exact grand total."""
    scale = 10
    target_units = round(target * scale)
    source_total = sum(totals.values())
    if source_total <= 0:
        return {name: 0.0 for name in totals}
    normalized = {
        name: value / source_total * target
        for name, value in totals.items()
    }
    units = {
        # The epsilon treats binary floating-point residue around 35.0 as 35.0.
        name: int(value * scale + 1e-7)
        for name, value in normalized.items()
    }
    remainder = target_units - sum(units.values())
    order = sorted(
        normalized,
        key=lambda name: normalized[name] * scale - units[name],
        reverse=True,
    )
    for index in range(max(0, remainder)):
        units[order[index % len(order)]] += 1
    return {name: units[name] / scale for name in totals}


def _apply_caps(
    weights: dict[str, float],
    sectors: dict[str, str],
) -> tuple[dict[str, float], bool, str | None]:
    """Find a fully invested allocation under both cap constraints.

    For a scaling factor ``lambda``, each candidate name receives
    ``min(9%, lambda * raw_weight)``. Candidate sector totals above 35% are
    scaled back inside that sector. The resulting total is monotonic in
    ``lambda``, so bisection finds the allocation that sums to 100%.
    """
    if not weights:
        return {}, False, "no eligible holdings"
    if len(weights) * SINGLE_NAME_CAP + 1e-9 < 100.0:
        return {}, False, "too few holdings to reach 100% under the 9% stock cap"

    if len(set(sectors.values())) * SECTOR_CAP + 1e-9 < 100.0:
        return {}, False, "too few sectors to reach 100% under the 35% sector cap"

    raw_total = sum(weights.values())
    if raw_total <= 0:
        return {}, False, "non-positive raw weights"
    raw = {ticker: weight / raw_total * 100.0 for ticker, weight in weights.items()}

    def allocation(scale: float) -> dict[str, float]:
        candidate = {
            ticker: min(SINGLE_NAME_CAP, max(0.0, weight * scale))
            for ticker, weight in raw.items()
        }
        sector_totals: dict[str, float] = {}
        for ticker, weight in candidate.items():
            group = sectors[ticker]
            sector_totals[group] = sector_totals.get(group, 0.0) + weight
        for ticker, weight in candidate.items():
            group_total = sector_totals[sectors[ticker]]
            if group_total > SECTOR_CAP + 1e-12:
                candidate[ticker] = weight * (SECTOR_CAP / group_total)
        return candidate

    low, high = 0.0, 1.0
    while sum(allocation(high).values()) < 100.0 and high < 1e9:
        high *= 2.0
    if sum(allocation(high).values()) + 1e-7 < 100.0:
        return {}, False, "cap constraints cannot reach 100%"

    for _ in range(120):
        middle = (low + high) / 2.0
        if sum(allocation(middle).values()) < 100.0:
            low = middle
        else:
            high = middle

    final = allocation((low + high) / 2.0)
    total = sum(final.values())
    if abs(total - 100.0) > 1e-6:
        return {}, False, "constraint solver did not converge"
    if any(weight > SINGLE_NAME_CAP + 1e-7 for weight in final.values()):
        return {}, False, "individual-name cap violated"
    sector_totals: dict[str, float] = {}
    for ticker, weight in final.items():
        sector_totals[sectors[ticker]] = sector_totals.get(sectors[ticker], 0.0) + weight
    if any(total > SECTOR_CAP + 1e-7 for total in sector_totals.values()):
        return {}, False, "sector cap violated"
    return final, True, None


def build_portfolio(
    scored: list[dict],
    *,
    target_holdings: int = TARGET_HOLDINGS,
) -> dict:
    if target_holdings not in SUPPORTED_HOLDING_COUNTS:
        raise ValueError(f"unsupported portfolio holding count: {target_holdings}")

    def valid_cap(row: dict) -> bool:
        value = row.get("float_market_cap")
        return isinstance(value, (int, float)) and math.isfinite(value) and value > 0

    def valid_score(row: dict) -> bool:
        value = row.get("score")
        return isinstance(value, (int, float)) and math.isfinite(value) and value > 0

    with_cap = [row for row in scored if valid_cap(row)]
    excluded_no_cap = [row["symbol"] for row in scored if not valid_cap(row)]
    excluded_no_score = [row["symbol"] for row in with_cap if not valid_score(row)]
    with_score = [row for row in with_cap if valid_score(row)]

    selected = with_score[:target_holdings]
    if not selected:
        return {
            "available": False,
            "holdings": [],
            "excluded_no_market_cap": excluded_no_cap,
            "excluded_no_score": excluded_no_score,
            "reason": (
                "no verified Momentum Scores"
                if with_cap
                else "no verified float-adjusted market caps"
            ),
        }
    if len(selected) < target_holdings:
        return {
            "available": False,
            "status": "infeasible",
            "holdings": [],
            "excluded_no_market_cap": excluded_no_cap,
            "excluded_no_score": excluded_no_score,
            "reason": f"too few holdings: {len(selected)} of {target_holdings} have verified fundamentals",
        }

    weighted_cap = {
        row["symbol"]: row["float_market_cap"] * row["score"]
        for row in selected
    }
    total_cap = sum(weighted_cap.values())
    if total_cap <= 0:
        return {
            "available": False,
            "holdings": [],
            "excluded_no_market_cap": excluded_no_cap,
            "excluded_no_score": excluded_no_score,
            "reason": "float-adjusted market cap and score produced no positive raw weights",
        }
    weights = {symbol: value / total_cap * 100.0 for symbol, value in weighted_cap.items()}
    solver_sectors = {row["symbol"]: group_sector(row["sector"]) for row in selected}
    final, feasible, reason = _apply_caps(weights, solver_sectors)
    if not feasible:
        return {
            "available": False,
            "status": "infeasible",
            "holdings": [],
            "excluded_no_market_cap": excluded_no_cap,
            "excluded_no_score": excluded_no_score,
            "reason": reason,
        }

    holdings = []
    for index, row in enumerate(selected):
        holdings.append(
            {
                "rank": index + 1,
                "ticker": row["symbol"],
                "company": row["company"],
                "sector": row["sector"] or "Other",
                "score": row["score"],
                "momentum_12_1": row["momentum_12_1"],
                "market_cap": row["market_cap"],
                "float_market_cap": row["float_market_cap"],
                "floatAdjustedMarketCapValue": row["float_market_cap"],
                "floatAdjustedMarketCap": format_cap(row["float_market_cap"]),
                "rawWeight": round(weights[row["symbol"]], 4),
                "finalWeight": round(final[row["symbol"]], 6),
            }
        )

    # Preserve an exact total after display rounding without moving a name above
    # its cap. Any residual cents come from the largest position with headroom.
    rounded_total = round(sum(holding["finalWeight"] for holding in holdings), 6)
    drift = round(100.0 - rounded_total, 6)
    if holdings and abs(drift) >= 1e-6:
        sector_before = {}
        for holding in holdings:
            sector_before[holding["sector"]] = sector_before.get(holding["sector"], 0.0) + holding["finalWeight"]
        candidates = [
            (weight, -index, holding)
            for index, holding in enumerate(holdings)
            for weight in [holding["finalWeight"]]
            if drift <= 0 or (
                weight + drift <= SINGLE_NAME_CAP + 1e-9
                and sector_before[holding["sector"]] + drift <= SECTOR_CAP + 1e-9
            )
        ]
        if candidates:
            _, _, target = max(candidates)
            target["finalWeight"] = round(target["finalWeight"] + drift, 6)

    sector_totals: dict[str, float] = {}
    for holding in holdings:
        sector_totals[holding["sector"]] = sector_totals.get(holding["sector"], 0.0) + holding["finalWeight"]
    rounded_sectors = _rounded_sector_values(sector_totals)
    sector_rows = [
        {"name": name, "value": rounded_sectors.get(name, 0.0), "color": SECTOR_COLORS[name]}
        for name in SECTOR_DISPLAY_ORDER
        if sector_totals.get(name, 0.0) > 0
    ]
    if sector_totals.get("Other", 0.0) > 0:
        sector_rows.append({
            "name": "Other",
            "value": rounded_sectors["Other"],
            "color": SECTOR_COLORS["Other"],
        })

    total_weight = sum(holding["finalWeight"] for holding in holdings)
    top_ten = sum(sorted((holding["finalWeight"] for holding in holdings), reverse=True)[:10])
    largest = max(holdings, key=lambda holding: holding["finalWeight"])
    constraints, validation = evaluate_portfolio_constraints(
        holdings,
        target_holdings=target_holdings,
    )

    return {
        "available": True,
        "status": "ready",
        "targetHoldings": target_holdings,
        "holdings": holdings,
        "sectors": sector_rows,
        "summary": {
            "totalHoldings": len(holdings),
            "largestHolding": {"ticker": largest["ticker"], "finalWeight": largest["finalWeight"]},
            "topTenWeight": round(top_ten, 1),
            "investedCapital": round(total_weight, 1),
        },
        "constraints": constraints,
        "validation": validation,
        "excluded_no_market_cap": excluded_no_cap,
        "excluded_no_score": excluded_no_score,
        "weighting": {
            "rawFormula": "float-adjusted market cap x momentum score",
            "solver": "proportional capped redistribution (bisection)",
            "converged": feasible,
        },
    }


def format_cap(value: float | None) -> str:
    if not value:
        return "—"
    if value >= 1e12:
        return f"${value / 1e12:.2f}T"
    if value >= 1e9:
        return f"${value / 1e9:.0f}B"
    return f"${value / 1e6:.0f}M"

"""Model portfolio construction and constraint enforcement.

Two rules are deliberately kept apart:

1. **Selection** uses the Momentum Score alone. Portfolio-investable stocks are
   ranked by score with a deterministic tie-break (higher score, then higher
   risk-adjusted momentum, then ticker) and the first ``target_holdings`` are
   taken. Market capitalisation never moves a stock up or down this ranking; it
   only decides whether a stock can be weighted at all, because a name with no
   verified float-adjusted market cap cannot receive a size weight.
2. **Weighting** sizes the selected names. The official default is
   ``Beta = 0.5``:

   ``raw weight = score x sqrt(float market cap / median float market cap)``

   The median is a common positive denominator, so it changes no normalized
   proportion; it keeps the exponent on a comparable, numerically well-behaved
   scale. A proportional redistribution then finds the allocation that satisfies
   both the individual-name and sector-group caps while remaining fully invested.
   If the constraints are infeasible, the function reports that state and does
   not publish an invalid book.
"""

from __future__ import annotations

import math
import statistics

# Official production weighting. Beta is intentionally not user-configurable.
MARKET_CAP_EXPONENT = 0.5
SUPPORTED_MARKET_CAP_EXPONENTS = (0.0, 0.5, 1.0)
WEIGHTING_METHOD_ID = "score-times-relative-float-market-cap-power"
METHODOLOGY_ID = "risk-adjusted-momentum-sqrt-float-cap-v1"

SINGLE_NAME_CAP = 9.0
SECTOR_CAP = 35.0
TARGET_HOLDINGS = 100
SUPPORTED_HOLDING_COUNTS = (20, 100)
WEIGHT_TOTAL_TOLERANCE = 0.01
CAP_ROUNDING_TOLERANCE = 1e-5

# The 35% cap is enforced on *combined sector groups*, not on the eleven
# individual sectors the donut chart displays. Both the solver and the published
# validation read this one mapping, so they can never disagree.
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
    # Group names map to themselves so ``group_sector`` is idempotent and a
    # grouped value can never be re-grouped into "Others" by mistake.
    "Consumer": "Consumer",
    "Others": "Others",
    "Other": "Others",
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
    """The canonical constraint classification for one holding.

    Unknown values fall into "Others" rather than silently forming a new group,
    and the mapping is idempotent for values that are already groups.
    """
    return SECTOR_GROUPS.get(sector, "Others")


canonical_sector = group_sector


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

    Sector totals are aggregated with the same canonical grouping the solver
    used to place the cap, so the published check can never approve an
    allocation under one classification while the book was built under another.

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
                "scope": "sector-group" if constraint_id == "max-sector" else "portfolio",
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
            "maximumSectorGroupWeight": None,
            "sectorsAtOrBelowCap": False,
            "topTenWeight": None,
        }

    total_weight = sum(weights)
    maximum_holding = max(weights)
    sector_totals: dict[str, float] = {}
    for holding, weight in zip(holdings, weights):
        group = canonical_sector(str(holding.get("sector") or "Other"))
        sector_totals[group] = sector_totals.get(group, 0.0) + weight
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
            "scope": "sector-group" if constraint_id == "max-sector" else "portfolio",
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
        "maximumSectorGroupWeight": round(maximum_sector, 4),
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

    ``sectors`` may hold either raw sector names or group names; every value is
    passed through :func:`canonical_sector`, which is idempotent, so the 35% cap
    always applies to the same groups the published validation reports.

    For a scaling factor ``lambda``, each candidate name receives
    ``min(9%, lambda * raw_weight)``. Candidate sector totals above 35% are
    scaled back inside that sector. The resulting total is monotonic in
    ``lambda``, so bisection finds the allocation that sums to 100%.
    """
    if not weights:
        return {}, False, "no eligible holdings"
    sectors = {ticker: canonical_sector(str(sector)) for ticker, sector in sectors.items()}
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


def selection_sort_key(row: dict) -> tuple:
    """Deterministic ordering: score, then risk-adjusted momentum, then ticker."""
    score = row.get("score")
    risk_adjusted = row.get("risk_adjusted")
    return (
        -float(score),
        -(
            float(risk_adjusted)
            if isinstance(risk_adjusted, (int, float)) and math.isfinite(risk_adjusted)
            else float("-inf")
        ),
        str(row.get("symbol") or ""),
    )


def rank_for_selection(scored: list[dict]) -> list[dict]:
    """Rank portfolio-investable stocks for Top N selection.

    Only Momentum Score orders this list. A verified, strictly positive
    float-adjusted market cap is an investability prerequisite, not a ranking
    input: a name without one cannot be sized, so it is excluded instead of
    being given an invented weight.
    """
    investable = [
        row
        for row in scored
        if isinstance(row.get("score"), (int, float))
        and math.isfinite(row["score"])
        and row["score"] > 0
        and isinstance(row.get("float_market_cap"), (int, float))
        and math.isfinite(row["float_market_cap"])
        and row["float_market_cap"] > 0
    ]
    return sorted(investable, key=selection_sort_key)


def raw_weights(
    selected: list[dict],
    *,
    market_cap_exponent: float = MARKET_CAP_EXPONENT,
) -> tuple[dict[str, float], dict]:
    """Relative-form size weights for the selected holdings.

    ``raw = score x (float cap / median float cap) ** beta``

    ``beta = 0`` is pure score weighting, ``beta = 0.5`` is the official
    square-root default, and ``beta = 1`` reproduces the former linear
    market-cap rule. The median denominator is shared by every name, so it
    cancels in normalization and only makes the numbers interpretable.
    """
    caps = [float(row["float_market_cap"]) for row in selected]
    median = float(statistics.median(caps)) if caps else 0.0
    if median <= 0:
        return {}, {"medianFloatMarketCap": None, "relativeTo": None}
    raw = {
        str(row["symbol"]): float(row["score"]) * (float(row["float_market_cap"]) / median) ** market_cap_exponent
        for row in selected
    }
    return raw, {
        "medianFloatMarketCap": median,
        "relativeTo": "median float-adjusted market cap of the selected holdings",
    }


def build_portfolio(
    scored: list[dict],
    *,
    target_holdings: int = TARGET_HOLDINGS,
    market_cap_exponent: float = MARKET_CAP_EXPONENT,
) -> dict:
    if target_holdings not in SUPPORTED_HOLDING_COUNTS:
        raise ValueError(f"unsupported portfolio holding count: {target_holdings}")
    if not (
        isinstance(market_cap_exponent, (int, float))
        and math.isfinite(market_cap_exponent)
        and 0.0 <= market_cap_exponent <= 2.0
    ):
        raise ValueError(f"unsupported market-cap exponent: {market_cap_exponent}")

    def valid_cap(row: dict) -> bool:
        value = row.get("float_market_cap")
        return isinstance(value, (int, float)) and math.isfinite(value) and value > 0

    def valid_score(row: dict) -> bool:
        value = row.get("score")
        return isinstance(value, (int, float)) and math.isfinite(value) and value > 0

    excluded_no_cap = [row["symbol"] for row in scored if valid_score(row) and not valid_cap(row)]
    excluded_no_score = [row["symbol"] for row in scored if not valid_score(row)]
    ranked = rank_for_selection(scored)

    selected = ranked[:target_holdings]
    if not selected:
        return {
            "available": False,
            "holdings": [],
            "excluded_no_market_cap": excluded_no_cap,
            "excluded_no_score": excluded_no_score,
            "reason": (
                "no verified float-adjusted market caps"
                if any(valid_score(row) for row in scored)
                else "no verified Momentum Scores"
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

    weighted_cap, weight_meta = raw_weights(selected, market_cap_exponent=market_cap_exponent)
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
    solver_sectors = {row["symbol"]: canonical_sector(str(row["sector"] or "Other")) for row in selected}
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
                "sectorGroup": solver_sectors[row["symbol"]],
                "score": row["score"],
                "momentum_12_1": row["momentum_12_1"],
                "market_cap": row["market_cap"],
                "float_market_cap": row["float_market_cap"],
                "floatAdjustedMarketCapValue": row["float_market_cap"],
                "floatAdjustedMarketCap": format_cap(row["float_market_cap"]),
                "relativeFloatMarketCap": round(
                    row["float_market_cap"] / weight_meta["medianFloatMarketCap"], 4
                ) if weight_meta["medianFloatMarketCap"] else None,
                "rawWeight": round(weights[row["symbol"]], 4),
                "finalWeight": round(final[row["symbol"]], 6),
            }
        )

    # Preserve an exact total after display rounding without moving a name above
    # its cap. Any residual cents come from the largest position with headroom.
    # The headroom test uses sector groups, the same scope the solver enforced.
    rounded_total = round(sum(holding["finalWeight"] for holding in holdings), 6)
    drift = round(100.0 - rounded_total, 6)
    if holdings and abs(drift) >= 1e-6:
        group_before = {}
        for holding in holdings:
            group_before[holding["sectorGroup"]] = group_before.get(holding["sectorGroup"], 0.0) + holding["finalWeight"]
        candidates = [
            (weight, -index, holding)
            for index, holding in enumerate(holdings)
            for weight in [holding["finalWeight"]]
            if drift <= 0 or (
                weight + drift <= SINGLE_NAME_CAP + 1e-9
                and group_before[holding["sectorGroup"]] + drift <= SECTOR_CAP + 1e-9
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
        "selection": {
            "rule": "Momentum Score, descending",
            "tieBreak": ["score:desc", "riskAdjusted:desc", "ticker:asc"],
            "scoredUniverse": len(scored),
            "investableUniverse": len(ranked),
            "selectedCount": len(holdings),
        },
        "weighting": {
            "methodologyId": METHODOLOGY_ID,
            "method": WEIGHTING_METHOD_ID,
            "marketCapExponent": market_cap_exponent,
            "rawFormula": (
                f"momentum score x (float-adjusted market cap / median float-adjusted market cap) ^ {market_cap_exponent:g}"
            ),
            "normalization": "raw weights scaled to 100% of invested capital before constraints",
            "medianFloatMarketCap": weight_meta["medianFloatMarketCap"],
            "relativeTo": weight_meta["relativeTo"],
            "sectorRule": "35% cap applied to canonical sector groups",
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

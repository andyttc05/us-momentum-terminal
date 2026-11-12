"""Model portfolio construction and constraint enforcement.

Selection is the top 100 eligible names by momentum score. Raw weights are
proportional to ``float-adjusted market cap x momentum score``. A proportional
redistribution finds the allocation that satisfies both the individual-name and
sector caps while remaining fully invested. If the constraints are infeasible,
the function reports that state and does not publish an invalid book.
"""

from __future__ import annotations

SINGLE_NAME_CAP = 9.0
SECTOR_CAP = 35.0
TARGET_HOLDINGS = 100

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


def build_portfolio(scored: list[dict]) -> dict:
    with_cap = [row for row in scored if row.get("float_market_cap")]
    excluded_no_cap = [row["symbol"] for row in scored if not row.get("float_market_cap")]

    selected = with_cap[:TARGET_HOLDINGS]
    if not selected:
        return {
            "available": False,
            "holdings": [],
            "excluded_no_market_cap": excluded_no_cap,
            "reason": "no verified float-adjusted market caps",
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
            "reason": "float-adjusted market cap and score produced no positive raw weights",
        }
    weights = {symbol: value / total_cap * 100.0 for symbol, value in weighted_cap.items()}
    solver_sectors = {row["symbol"]: group_sector(row["sector"]) for row in selected}
    final, feasible, reason = _apply_caps(weights, solver_sectors)
    if not feasible:
        return {
            "available": False,
            "holdings": [],
            "excluded_no_market_cap": excluded_no_cap,
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
    sector_rows = [
        {"name": name, "value": round(sector_totals.get(name, 0.0), 1), "color": SECTOR_COLORS[name]}
        for name in SECTOR_DISPLAY_ORDER
        if sector_totals.get(name, 0.0) > 0
    ]
    if sector_totals.get("Other", 0.0) > 0:
        sector_rows.append({
            "name": "Other",
            "value": round(sector_totals["Other"], 1),
            "color": SECTOR_COLORS["Other"],
        })

    total_weight = sum(holding["finalWeight"] for holding in holdings)
    maximum_holding = max(holding["finalWeight"] for holding in holdings)
    maximum_sector = max(sector_totals.values())
    top_ten = sum(sorted((holding["finalWeight"] for holding in holdings), reverse=True)[:10])
    largest = max(holdings, key=lambda holding: holding["finalWeight"])

    constraints = [
        {"id": "max-stock", "label": "Max Stock Weight", "rule": "≤ 9%", "passed": maximum_holding <= SINGLE_NAME_CAP + 1e-6},
        {"id": "max-sector", "label": "Max Sector Weight", "rule": "≤ 35%", "passed": maximum_sector <= 35.0 + 1e-5},
        {"id": "target-holdings", "label": "Target Holdings", "rule": "= 100", "passed": len(holdings) == TARGET_HOLDINGS},
        {"id": "fully-invested", "label": "Fully Invested", "rule": "= 100%", "passed": abs(total_weight - 100.0) < 0.01},
    ]

    return {
        "available": True,
        "holdings": holdings,
        "sectors": sector_rows,
        "summary": {
            "totalHoldings": len(holdings),
            "largestHolding": {"ticker": largest["ticker"], "finalWeight": largest["finalWeight"]},
            "topTenWeight": round(top_ten, 1),
            "investedCapital": round(total_weight, 1),
        },
        "constraints": constraints,
        "validation": {
            "holdingCount": len(holdings),
            "totalFinalWeight": round(total_weight, 2),
            "maximumHoldingWeight": maximum_holding,
            "maximumSectorWeight": round(maximum_sector, 4),
            "sectorsAtOrBelowCap": maximum_sector <= 35.0 + 1e-5,
            "topTenWeight": round(top_ten, 1),
        },
        "excluded_no_market_cap": excluded_no_cap,
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

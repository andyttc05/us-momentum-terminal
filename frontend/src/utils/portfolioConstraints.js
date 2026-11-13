export const PORTFOLIO_LIMITS = Object.freeze({
  maximumStockWeight: 9,
  maximumSectorWeight: 35,
  targetHoldings: 100,
  capRoundingTolerance: 1e-5,
  totalWeightTolerance: 0.01,
});

export function portfolioConstraintDefinitions(targetHoldings = PORTFOLIO_LIMITS.targetHoldings) {
  return Object.freeze([
    Object.freeze({ id: "max-stock", label: "Max Stock Weight", rule: "≤ 9%" }),
    Object.freeze({ id: "max-sector", label: "Max Sector Weight", rule: "≤ 35%" }),
    Object.freeze({ id: "target-holdings", label: "Target Holdings", rule: `= ${targetHoldings}` }),
    Object.freeze({ id: "target-allocation", label: "Target Allocation", rule: "= 100%" }),
  ]);
}

export const PORTFOLIO_CONSTRAINT_DEFINITIONS = portfolioConstraintDefinitions();

function isFiniteWeight(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function unavailableConstraints(definitions) {
  return definitions.map((definition) => ({
    ...definition,
    passed: false,
    status: "unavailable",
  }));
}

/**
 * Recompute the published constraint statuses from the final holdings.
 *
 * The API is allowed to describe the same result, but the UI never treats a
 * passed boolean as sufficient evidence by itself. Missing weights stay
 * unevaluated, and every published rule must pass independently.
 */
export function evaluatePortfolioConstraints(
  holdings,
  targetHoldings = PORTFOLIO_LIMITS.targetHoldings,
) {
  const rows = Array.isArray(holdings) ? holdings : [];
  const definitions = portfolioConstraintDefinitions(targetHoldings);
  if (!rows.length || !rows.every((holding) => isFiniteWeight(holding?.finalWeight))) {
    return {
      evaluated: false,
      constraints: unavailableConstraints(definitions),
      validation: {
        holdingCount: rows.length,
        totalFinalWeight: null,
        maximumHoldingWeight: null,
        maximumSectorWeight: null,
      },
    };
  }

  const weights = rows.map((holding) => holding.finalWeight);
  const totalFinalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const maximumHoldingWeight = Math.max(...weights);
  const sectorWeights = new Map();
  rows.forEach((holding) => {
    const sector = String(holding?.sector || "Other");
    sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + holding.finalWeight);
  });
  const maximumSectorWeight = Math.max(...sectorWeights.values());
  const passedById = {
    "max-stock": maximumHoldingWeight
      <= PORTFOLIO_LIMITS.maximumStockWeight + PORTFOLIO_LIMITS.capRoundingTolerance,
    "max-sector": maximumSectorWeight
      <= PORTFOLIO_LIMITS.maximumSectorWeight + PORTFOLIO_LIMITS.capRoundingTolerance,
    "target-holdings": rows.length === targetHoldings,
    "target-allocation": Math.abs(totalFinalWeight - 100)
      <= PORTFOLIO_LIMITS.totalWeightTolerance,
  };

  return {
    evaluated: true,
    constraints: definitions.map((definition) => ({
      ...definition,
      passed: passedById[definition.id],
      status: passedById[definition.id] ? "passed" : "failed",
    })),
    validation: {
      holdingCount: rows.length,
      totalFinalWeight,
      maximumHoldingWeight,
      maximumSectorWeight,
    },
  };
}

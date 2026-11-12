import { csvRow } from "./csv.js";

/**
 * Portfolio CSV export.
 *
 * The export always uses the complete holdings dataset from the market
 * payload — never the rows that happen to be on the current pagination page.
 */

export const PORTFOLIO_CSV_COLUMNS = [
  "Rank",
  "Ticker",
  "Sector",
  "Momentum Score",
  "Float-Adjusted Market Cap (USD)",
  "Raw Weight (%)",
  "Final Weight (%)",
];

const TOLERANCE = 0.05; // total final weight may differ from 100 by rounding only

/** Pull the numeric cap out of a constraint rule such as "≤ 9%". */
function parseCap(rule) {
  const match = /(\d+(?:\.\d+)?)/.exec(String(rule ?? ""));
  return match ? Number(match[1]) : null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Check the portfolio before it is exported. Returns the computed figures plus
 * a list of problems; the caller must not export when `ok` is false and must
 * never silently "fix" the data.
 */
export function validatePortfolioForExport({ holdings, validation, constraints }) {
  const problems = [];
  const rows = Array.isArray(holdings) ? holdings : [];

  if (!rows.length) problems.push("the portfolio has no holdings");

  const tickers = new Set();
  let totalFinalWeight = 0;
  let maximumHoldingWeight = 0;
  const sectorWeights = new Map();

  rows.forEach((holding) => {
    const ticker = String(holding?.ticker ?? "").trim();
    if (!ticker) problems.push("a holding is missing its ticker");
    else if (tickers.has(ticker)) problems.push(`${ticker} appears more than once`);
    else tickers.add(ticker);

    if (!Number.isInteger(holding?.rank) || holding.rank < 1) {
      problems.push(`${ticker || "a holding"} has an invalid rank`);
    }
    if (!isFiniteNumber(holding?.score)) problems.push(`${ticker || "a holding"} has an invalid score`);
    if (!isFiniteNumber(holding?.market_cap)) problems.push(`${ticker || "a holding"} has an invalid market cap`);
    if (!isFiniteNumber(holding?.float_market_cap)) problems.push(`${ticker || "a holding"} has an invalid float-adjusted market cap`);
    if (!isFiniteNumber(holding?.rawWeight)) problems.push(`${ticker || "a holding"} has an invalid raw weight`);
    if (!isFiniteNumber(holding?.finalWeight)) problems.push(`${ticker || "a holding"} has an invalid final weight`);

    if (isFiniteNumber(holding?.finalWeight)) {
      totalFinalWeight += holding.finalWeight;
      maximumHoldingWeight = Math.max(maximumHoldingWeight, holding.finalWeight);
      const sector = String(holding?.sector ?? "Unknown");
      sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + holding.finalWeight);
    }
  });

  const expectedCount = validation?.holdingCount;
  if (isFiniteNumber(expectedCount) && expectedCount !== rows.length) {
    problems.push(`expected ${expectedCount} holdings but found ${rows.length}`);
  }

  if (Math.abs(totalFinalWeight - 100) > TOLERANCE) {
    problems.push(`total final weight is ${totalFinalWeight.toFixed(2)}%, expected 100%`);
  }

  const stockCap = isFiniteNumber(validation?.maximumHoldingWeight)
    ? validation.maximumHoldingWeight
    : parseCap(constraints?.find((item) => item?.id === "max-stock")?.rule);
  if (isFiniteNumber(stockCap) && maximumHoldingWeight > stockCap + 0.001) {
    problems.push(`a position is ${maximumHoldingWeight.toFixed(2)}%, above the ${stockCap}% cap`);
  }

  const sectorCap = parseCap(constraints?.find((item) => item?.id === "max-sector")?.rule);
  if (isFiniteNumber(sectorCap)) {
    const worst = [...sectorWeights.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst && worst[1] > sectorCap + 0.001) {
      problems.push(`sector ${worst[0]} is ${worst[1].toFixed(2)}%, above the ${sectorCap}% cap`);
    }
  } else if (validation?.sectorsAtOrBelowCap === false) {
    problems.push("a sector is above its weight cap");
  }

  return {
    ok: problems.length === 0,
    problems,
    rowCount: rows.length,
    totalFinalWeight: Number(totalFinalWeight.toFixed(2)),
    maximumHoldingWeight: Number(maximumHoldingWeight.toFixed(2)),
    sectorWeights: [...sectorWeights.entries()].map(([sector, weight]) => ({ sector, weight: Number(weight.toFixed(2)) })),
  };
}

/**
 * Sort the holdings by final weight, largest first.
 *
 * Holdings with the same final weight keep their original portfolio order. The
 * exported rank remains the strategy rank; it is not renumbered by weight
 * order. The source holdings are never mutated.
 */
export function sortHoldingsByFinalWeight(holdings) {
  return (holdings ?? [])
    .map((holding, index) => ({ holding, index }))
    .sort((left, right) => {
      const leftWeight = Number.isFinite(left.holding?.finalWeight) ? left.holding.finalWeight : -Infinity;
      const rightWeight = Number.isFinite(right.holding?.finalWeight) ? right.holding.finalWeight : -Infinity;
      if (leftWeight !== rightWeight) return rightWeight - leftWeight;
      return left.index - right.index;
    })
    .map((entry) => entry.holding);
}

/** Build the CSV text for the complete holdings dataset, sorted by final weight. */
export function buildPortfolioCsv(holdings) {
  const header = csvRow(PORTFOLIO_CSV_COLUMNS);
  const rows = sortHoldingsByFinalWeight(holdings).map((holding) => csvRow([
    holding.rank,
    holding.ticker,
    holding.sector,
    holding.score,
    holding.float_market_cap,
    holding.rawWeight,
    holding.finalWeight,
  ]));
  return [header, ...rows].join("\r\n");
}

/** `US_Momentum_Portfolio_YYYY-MM-DD.csv` using the export date. */
export function portfolioCsvFilename(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `US_Momentum_Portfolio_${stamp}.csv`;
}

import { csvRow } from "./csv.js";
import { EXCEL_FORMAT, exportTimestamp } from "./exportFiles.js";
import { universeLabel } from "./universeState.js";

/**
 * Portfolio CSV export.
 *
 * The export always uses the complete holdings dataset from the market
 * payload — never the rows that happen to be on the current pagination page.
 */

export const PORTFOLIO_CSV_COLUMNS = [
  "Rank",
  "Ticker",
  "Company",
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
    holding.company ?? null,
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

export function portfolioFilename(universe, extension) {
  return `US_Momentum_Portfolio_${universe === "top20" ? "Top20" : "Top100"}.${extension}`;
}

function holdingRows(holdings) {
  return sortHoldingsByFinalWeight(holdings).map((holding) => [
    holding.rank,
    holding.ticker,
    holding.company ?? null,
    holding.sector,
    holding.score,
    holding.float_market_cap,
    holding.rawWeight,
    holding.finalWeight,
  ]);
}

function observedConstraintValue(constraintId, portfolio) {
  const validation = portfolio?.validation ?? {};
  if (constraintId === "max-stock") return validation.maximumHoldingWeight ?? null;
  if (constraintId === "max-sector") return validation.maximumSectorWeight ?? null;
  if (constraintId === "target-holdings") return portfolio?.holdings?.length ?? null;
  if (constraintId === "target-allocation") return validation.totalFinalWeight ?? null;
  return null;
}

export function buildPortfolioExportData({
  portfolio,
  universe,
  meta,
  exportedAt = exportTimestamp(),
}) {
  if (!portfolio?.holdings?.length) {
    throw new Error("The selected portfolio has no holdings to export.");
  }
  const holdings = portfolio.holdings;
  const summary = portfolio.summary ?? {};
  const sectorRows = (portfolio.sectors ?? []).map((sector) => [sector.name, sector.value]);
  const distributionRows = [...holdings]
    .sort((left, right) => right.finalWeight - left.finalWeight)
    .map((holding) => [holding.rank, holding.ticker, holding.finalWeight]);
  const constraintRows = (portfolio.constraints ?? []).map((constraint) => [
    constraint.label,
    constraint.rule,
    observedConstraintValue(constraint.id, portfolio),
    constraint.status,
  ]);
  const settings = [
    ["Universe Selection", universeLabel(universe)],
    ["Portfolio Methodology", portfolio.weighting?.rawFormula ?? null],
    ["Constraint Solver", portfolio.weighting?.solver ?? null],
    ["Solver Converged", typeof portfolio.weighting?.converged === "boolean"
      ? (portfolio.weighting.converged ? "Yes" : "No")
      : null],
    ["Data As Of", meta?.as_of ?? null],
    ["Data Generated At", meta?.generated_at ?? null],
    ["Data Freshness", meta?.client_cache ? "Browser cache" : (meta?.cache_state ?? null)],
    ["Export Timestamp", exportedAt],
  ];

  return {
    workbookSheets: [
      {
        name: "Holdings",
        rows: [
          [
            "Rank",
            "Ticker",
            "Company",
            "Sector",
            "Momentum Score",
            "Float-Adjusted Market Cap (USD)",
            "Raw Weight (%)",
            "Final Weight (%)",
          ],
          ...holdingRows(holdings),
        ],
        widths: [9, 12, 34, 24, 18, 31, 17, 18],
        formats: {
          4: EXCEL_FORMAT.number,
          5: EXCEL_FORMAT.currency,
          6: EXCEL_FORMAT.weight,
          7: EXCEL_FORMAT.weight,
        },
        autoFilter: true,
        freezeHeader: true,
      },
      {
        name: "Portfolio Summary",
        rows: [
          ["Summary", "Value"],
          ["Total Holdings", summary.totalHoldings ?? holdings.length],
          [
            "Largest Holding",
            summary.largestHolding?.ticker
              ? `${summary.largestHolding.ticker} (${Number(summary.largestHolding.finalWeight).toFixed(2)}%)`
              : null,
          ],
          ["Top 10 Weight (%)", summary.topTenWeight ?? null],
          [],
          ["Sector Allocation", "Weight (%)"],
          ...sectorRows,
          [],
          ["Stock Weight Distribution", "Final Weight (%)"],
          ["Rank", "Ticker", "Final Weight (%)"],
          ...distributionRows,
        ],
        widths: [32, 65],
        formats: { 1: EXCEL_FORMAT.weight },
        freezeHeader: true,
      },
      {
        name: "Portfolio Constraints",
        rows: [
          ["Constraint", "Rule", "Observed Value", "Status"],
          ...constraintRows,
        ],
        widths: [28, 15, 20, 15],
        formats: { 2: EXCEL_FORMAT.weight },
        autoFilter: true,
        freezeHeader: true,
      },
      {
        name: "Portfolio Settings",
        rows: [["Setting", "Value"], ...settings],
        widths: [30, 64],
        formats: { 1: null },
        freezeHeader: true,
      },
    ],
    rowCount: holdings.length,
  };
}

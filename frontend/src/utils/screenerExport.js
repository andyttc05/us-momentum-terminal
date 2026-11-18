import { csvRow } from "./csv.js";
import { EXCEL_FORMAT, exportTimestamp } from "./exportFiles.js";
import { universeLabel } from "./universeState.js";

const RESULT_COLUMNS = [
  "Rank",
  "Ticker",
  "Company",
  "Market Cap",
  "Price",
  "1D Change (%)",
  "12-1 Momentum (%)",
  "Momentum Score",
  "Sector",
];

function filterRows(filters = {}, search = "") {
  return [
    ["Search", search.trim() || "None"],
    ["Sector", filters.sector || "All sectors"],
    ["Minimum Price", filters.minPrice === "" ? null : Number(filters.minPrice)],
    ["Maximum Price", filters.maxPrice === "" ? null : Number(filters.maxPrice)],
    ["Minimum 12-1 Momentum (%)", filters.minMomentum === "" ? null : Number(filters.minMomentum)],
    ["Minimum Momentum Score", filters.minScore === "" ? null : Number(filters.minScore)],
  ];
}

function resultRows(stocks) {
  return stocks.map((stock) => [
    stock.rank,
    stock.ticker,
    stock.company,
    stock.marketCap,
    stock.price,
    stock.change,
    stock.momentum,
    stock.score,
    stock.sector,
  ]);
}

/** Scope labels, shared by the file name and the screening-settings sheet. */
const SCOPE_LABELS = Object.freeze({ all: "All Stocks", top100: "Top 100", top20: "Top 20" });

export function screenerFilename(scope, extension) {
  const suffix = scope === "all" ? "AllStocks" : scope === "top20" ? "Top20" : "Top100";
  return `US_Momentum_Screener_${suffix}.${extension}`;
}

export function buildScreenerExportData({
  stocks,
  universe,
  filters,
  search,
  meta,
  exportedAt = exportTimestamp(),
}) {
  if (!Array.isArray(stocks)) throw new Error("The Screener result set is unavailable.");
  const rows = resultRows(stocks);
  const settings = [
    ["Universe Selection", SCOPE_LABELS[universe] ?? universeLabel(universe)],
    ["Matching Records", rows.length],
    ...filterRows(filters, search),
    ["Data As Of", meta?.as_of ?? null],
    ["Data Generated At", meta?.generated_at ?? null],
    ["Data Freshness", meta?.client_cache ? "Browser cache" : (meta?.cache_state ?? null)],
    ["Export Timestamp", exportedAt],
  ];
  const csvRows = [RESULT_COLUMNS, ...rows];

  return {
    csv: csvRows.map((row) => csvRow(row)).join("\r\n"),
    workbookSheets: [
      {
        name: "Screener Results",
        rows: csvRows,
        widths: [9, 12, 34, 20, 14, 17, 22, 18, 24],
        formats: {
          3: EXCEL_FORMAT.currency,
          4: EXCEL_FORMAT.currency,
          5: EXCEL_FORMAT.percent,
          6: EXCEL_FORMAT.percent,
          7: EXCEL_FORMAT.number,
        },
        autoFilter: true,
        freezeHeader: true,
      },
      {
        name: "Screening Settings",
        rows: [["Setting", "Value"], ...settings],
        widths: [32, 48],
        formats: { 1: null },
        freezeHeader: true,
      },
    ],
    rowCount: rows.length,
  };
}

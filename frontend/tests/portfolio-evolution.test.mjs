import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE,
  buildPortfolioEvolutionExportData,
  comparePortfolioEvent,
  eventsForYear,
  filterPortfolioHoldings,
  formatTurnover,
  normalizePortfolioEvents,
  paginatePortfolioRows,
  portfolioEventYears,
  portfolioEvolutionFilename,
  summarizePortfolioEvents,
  visiblePortfolioRows,
} from "../src/utils/portfolioEvolution.js";

function readJson(path) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
}

const top20 = readJson("../public/data/backtests/top20/semiannual.json");
const top100 = readJson("../public/data/backtests/top100/semiannual.json");
const top20Events = normalizePortfolioEvents(top20);
const top100Events = normalizePortfolioEvents(top100);

test("both published and API event field names normalize to the same shape", () => {
  const holding = {
    signal_date: "2026-09-30",
    execution_date: "2026-10-01",
    type: "scheduled",
    holdings: { MU: 5, TGT: 5 },
    turnover_pct: 50,
  };
  const published = normalizePortfolioEvents({ rebalance_log: [holding] });
  const direct = normalizePortfolioEvents({ holdings_log: [holding] });
  assert.deepEqual(published, direct);
  assert.deepEqual(published[0].holdings, [
    { ticker: "MU", weight: 5 },
    { ticker: "TGT", weight: 5 },
  ]);
});

test("events sort newest first and default to the latest execution", () => {
  const events = normalizePortfolioEvents({
    rebalance_log: [
      {
        signal_date: "2024-03-28",
        execution_date: "2024-04-01",
        type: "scheduled",
        holdings: { B: 10 },
        turnover_pct: 30,
      },
      {
        signal_date: "2024-09-30",
        execution_date: "2024-10-01",
        type: "scheduled",
        holdings: { A: 10 },
        turnover_pct: 20,
      },
    ],
  });
  assert.deepEqual(events.map((event) => event.executionDate), ["2024-10-01", "2024-04-01"]);
  assert.equal(summarizePortfolioEvents(events).latestEvent.holdings[0].ticker, "A");
});

test("Top 20 KPIs use every event and exclude initial formation from average turnover", () => {
  const summary = summarizePortfolioEvents(top20Events);
  assert.equal(summary.totalEvents, 18);
  assert.equal(summary.initialCount, 1);
  assert.equal(summary.scheduledCount, 17);
  assert.equal(summary.scheduledTurnoverCount, 17);
  assert.equal(formatTurnover(summary.averageScheduledTurnoverPct), "65.02%");
  assert.notEqual(summary.averageScheduledTurnoverPct, top20Events[0].turnoverPct);
});

test("the latest Top 20 event reconciles to the published 13 new, 7 retained and 13 removed", () => {
  const comparison = comparePortfolioEvent(top20Events, top20Events[0]);
  assert.equal(top20Events[0].executionDate, "2026-10-01");
  assert.equal(top20Events[0].signalDate, "2026-09-30");
  assert.equal(top20Events[0].count, 20);
  assert.equal(top20Events[0].turnoverPct, 66.64);
  assert.deepEqual(comparison.counts, { all: 20, new: 13, retained: 7, removed: 13 });
  assert.equal(comparison.currentRows.every((row) => row.weight === 5), true);
  assert.equal(comparison.removedRows.every((row) => row.weight === 5), true);
});

test("initial formation marks every holding Initial and creates no fabricated comparison", () => {
  const initial = top20Events.at(-1);
  const comparison = comparePortfolioEvent(top20Events, initial);
  assert.equal(initial.initial, true);
  assert.equal(comparison.currentRows.length, 20);
  assert.equal(comparison.currentRows.every((row) => row.status === "initial"), true);
  assert.deepEqual(comparison.counts, { all: 20, new: 0, retained: 0, removed: 0 });
  assert.equal(comparison.removedRows.length, 0);
});

test("a stale event object cannot be compared against an unrelated history", () => {
  const comparison = comparePortfolioEvent(top20Events, {
    id: "missing-event",
    holdings: [{ ticker: "FAKE", weight: 100 }],
  });
  assert.deepEqual(comparison.counts, { all: 0, new: 0, retained: 0, removed: 0 });
  assert.equal(comparison.currentRows.length, 0);
});

test("removed holdings show actual tickers and previous weights, never current weights", () => {
  const comparison = comparePortfolioEvent(top20Events, top20Events[0]);
  const removed = visiblePortfolioRows(comparison, "removed", "");
  assert.equal(removed.length, 13);
  assert.equal(removed[0].ticker, "GOOGL");
  assert.equal(removed[0].weight, 5);
  assert.equal(removed[0].weightBasis, "Previous Target Weight");
  assert.equal(comparison.currentRows.some((row) => row.status === "removed"), false);
});

test("search and status filters work together and counts come from the full snapshot", () => {
  const comparison = comparePortfolioEvent(top20Events, top20Events[0]);
  const currentRows = comparison.currentRows.map((row) => (
    row.ticker === "MU" ? { ...row, company: "Micron Technology, Inc." } : row
  ));
  const enriched = { ...comparison, currentRows };
  assert.equal(visiblePortfolioRows(enriched, "retained", "micron").length, 1);
  assert.equal(visiblePortfolioRows(enriched, "new", "micron").length, 0);
  assert.equal(visiblePortfolioRows(enriched, "all", "tgt").length, 1);
  assert.equal(filterPortfolioHoldings(currentRows, "retained", "").length, 7);
});

test("holdings paginate ten rows at a time without losing the full filtered set", () => {
  const comparison = comparePortfolioEvent(top100Events, top100Events[0]);
  const rows = visiblePortfolioRows(comparison, "all", "");
  const first = paginatePortfolioRows(rows, 1, PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE);
  const last = paginatePortfolioRows(rows, 10, PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE);
  assert.equal(rows.length, 100);
  assert.equal(first.rows.length, 10);
  assert.equal(first.totalPages, 10);
  assert.equal(last.rows.length, 10);
  assert.equal(last.rangeStart, 91);
  assert.equal(last.rangeEnd, 100);
});

test("year filtering is populated from events and retains a valid selection", () => {
  assert.deepEqual(portfolioEventYears(top20Events), [
    "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018",
  ]);
  const selected = eventsForYear(top20Events, "2025");
  assert.equal(selected.every((event) => event.executionDate.startsWith("2025-")), true);
});

test("changing the event updates the actual holdings snapshot", () => {
  const latest = comparePortfolioEvent(top20Events, top20Events[0]);
  const previous = comparePortfolioEvent(top20Events, top20Events[1]);
  assert.notDeepEqual(
    latest.currentRows.map((row) => row.ticker),
    previous.currentRows.map((row) => row.ticker),
  );
  assert.equal(previous.currentRows.some((row) => row.ticker === "MMM"), false);
});

test("Top 20 and Top 100 histories never share holdings or weights", () => {
  assert.equal(top20Events[0].count, 20);
  assert.equal(top100Events[0].count, 100);
  assert.equal(top20Events[0].holdings.every((row) => row.weight === 5), true);
  assert.equal(top100Events[0].holdings.every((row) => row.weight === 1), true);
  assert.notDeepEqual(
    top20Events[0].holdings.map((row) => row.ticker),
    top100Events[0].holdings.map((row) => row.ticker),
  );
});

test("unavailable schedules expose no fabricated events", () => {
  assert.deepEqual(normalizePortfolioEvents(null), []);
  assert.deepEqual(normalizePortfolioEvents({ available: false, reason: "unavailable" }), []);
  const summary = summarizePortfolioEvents([]);
  assert.equal(summary.totalEvents, 0);
  assert.equal(summary.averageScheduledTurnoverPct, null);
  assert.equal(summary.latestEvent, null);
});

test("CSV and workbook exports include every matching row, not only the first page", () => {
  const comparison = comparePortfolioEvent(top100Events, top100Events[0]);
  const retained = visiblePortfolioRows(comparison, "retained", "");
  const exportData = buildPortfolioEvolutionExportData({
    block: top100,
    config: { portfolio: "top100", rebalanceFrequency: "semiannual" },
    selectedEvent: top100Events[0],
    rows: retained,
  });
  assert.equal(retained.length, 95);
  assert.equal(exportData.rowCount, 95);
  assert.equal(exportData.csv.split("\r\n").length, 96);
  const holdingsSheet = exportData.workbookSheets[0];
  assert.equal(holdingsSheet.name, "Historical Holdings");
  assert.deepEqual(holdingsSheet.rows[0], [
    "Ticker",
    "Company",
    "Weight",
    "Weight Basis",
    "Status",
    "Signal Date",
    "Execution Date",
  ]);
  assert.equal(holdingsSheet.rows.length, 96);
  assert.equal(holdingsSheet.rows[1][3], "Current Target Weight");
});

test("removed CSV rows use previous weights and all records have matching column counts", () => {
  const comparison = comparePortfolioEvent(top20Events, top20Events[0]);
  const removed = visiblePortfolioRows(comparison, "removed", "");
  const exportData = buildPortfolioEvolutionExportData({
    block: top20,
    config: { portfolio: "top20", rebalanceFrequency: "semiannual" },
    selectedEvent: top20Events[0],
    rows: removed,
  });
  const lines = exportData.csv.split("\r\n");
  assert.equal(lines.length, 14);
  assert.match(lines[1], /Previous Target Weight/);
  assert.match(lines[1], /Removed/);
  for (const line of lines) {
    assert.equal(line.split(",").length, 7);
  }
  assert.doesNotMatch(exportData.csv, /Share Quantity|Execution Price|Transaction Fee/);
});

test("workbook has two useful sheets and the filename carries execution, universe and schedule", () => {
  const comparison = comparePortfolioEvent(top20Events, top20Events[0]);
  const rows = visiblePortfolioRows(comparison, "new", "");
  const config = { portfolio: "top20", rebalanceFrequency: "semiannual" };
  const exportData = buildPortfolioEvolutionExportData({
    block: top20,
    config,
    selectedEvent: top20Events[0],
    rows,
  });
  assert.deepEqual(exportData.workbookSheets.map((sheet) => sheet.name), [
    "Historical Holdings",
    "Rebalance Details",
  ]);
  assert.deepEqual(
    exportData.workbookSheets[1].rows.map((row) => row[0]),
    [
      "Field",
      "Signal Date",
      "Execution Date",
      "Event Type",
      "Rebalancing Frequency",
      "Universe Selection",
      "Holdings Count",
      "One-way Turnover",
      "Weighting Method",
    ],
  );
  assert.equal(
    portfolioEvolutionFilename(config, top20Events[0], "xlsx"),
    "US_Momentum_Holdings_Top20_Semiannual_2026-10-01.xlsx",
  );
});

test("Portfolio Evolution follows Performance Summary and keeps the holdings table scroll-bounded", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
    "utf8",
  );
  const styles = readFileSync(
    fileURLToPath(new URL("../src/styles/backtesting.css", import.meta.url)),
    "utf8",
  );
  assert.ok(page.indexOf("<PerformanceSummary") < page.indexOf("<PortfolioEvolution"));
  assert.doesNotMatch(page, /sidebar[^\n]*Portfolio Evolution/i);
  assert.match(styles, /grid-template-columns: minmax\(0, 0\.88fr\) minmax\(598px, 1\.34fr\)/);
  assert.match(styles, /\.portfolio-evolution__table-wrap[\s\S]*?overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 1240px\)[\s\S]*?\.portfolio-evolution__workspace \{ grid-template-columns: minmax\(0, 1fr\)/);
});

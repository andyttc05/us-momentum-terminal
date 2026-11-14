import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOLDINGS_SORT,
  HOLDINGS_SORT_FIELDS,
  PORTFOLIO_EVOLUTION_EVENTS_PAGE_SIZE,
  PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE,
  buildPortfolioEvolutionExportData,
  comparePortfolioEvent,
  eventsForYear,
  filterPortfolioHoldings,
  formatHistoricalPortfolioWeight,
  formatTurnover,
  formatWeightChange,
  historicalPortfolioWeightAvailable,
  normalizePortfolioEvents,
  paginatePortfolioRows,
  portfolioEventYears,
  portfolioEvolutionFilename,
  sortPortfolioRows,
  summarizePortfolioEvents,
  visiblePortfolioRows,
  weightChangeTone,
} from "../src/utils/portfolioEvolution.js";
import { EXCEL_FORMAT } from "../src/utils/exportFiles.js";

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

test("history and holdings use the approved five-row page size", () => {
  assert.equal(PORTFOLIO_EVOLUTION_EVENTS_PAGE_SIZE, 5);
  assert.equal(PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE, 5);
});

test("Top 20 KPIs use every event and exclude initial formation from average turnover", () => {
  const summary = summarizePortfolioEvents(top20Events);
  const scheduled = top20Events.filter((event) => !event.initial);
  const expectedAverage = scheduled.reduce(
    (total, event) => total + event.turnoverPct,
    0,
  ) / scheduled.length;
  assert.equal(summary.totalEvents, 18);
  assert.equal(summary.initialCount, 1);
  assert.equal(summary.scheduledCount, 17);
  assert.equal(summary.scheduledTurnoverCount, 17);
  assert.equal(summary.averageScheduledTurnoverPct, expectedAverage);
  assert.equal(
    formatTurnover(summary.averageScheduledTurnoverPct),
    formatTurnover(expectedAverage),
  );
  assert.notEqual(summary.averageScheduledTurnoverPct, top20Events[0].turnoverPct);
});

test("the latest Top 20 event reconciles to the published 13 new, 7 retained and 13 removed", () => {
  const comparison = comparePortfolioEvent(top20Events, top20Events[0]);
  assert.equal(top20Events[0].executionDate, "2026-10-01");
  assert.equal(top20Events[0].signalDate, "2026-09-30");
  assert.equal(top20Events[0].count, 20);
  assert.equal(
    top20Events[0].turnoverPct,
    top20.rebalance_log.at(-1).turnover_pct,
  );
  assert.deepEqual(comparison.counts, { all: 20, new: 13, retained: 7, removed: 13 });
  assert.equal(
    comparison.currentRows.every((row) => row.weightingMode === "score-size-proxy"),
    true,
  );
  assert.equal(
    comparison.removedRows.every((row) => row.weightingMode === top20Events[1].weightingMode),
    true,
  );
  assert.ok(Math.abs(
    comparison.currentRows.reduce((total, row) => total + row.weight, 0) - 100,
  ) < 0.001);
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
  const previousHoldings = top20Events[1].holdings;
  assert.equal(removed.length, 13);
  assert.equal(removed[0].ticker, "GOOGL");
  assert.equal(
    removed[0].weight,
    previousHoldings.find((holding) => holding.ticker === "GOOGL").weight,
  );
  assert.equal(removed[0].weightBasis, "Previous Target Weight");
  assert.equal(comparison.currentRows.some((row) => row.status === "removed"), false);
});

test("every published event weight is displayed as that event's own allocation", () => {
  for (const events of [top20Events, top100Events]) {
    const rows = comparePortfolioEvent(events, events[0]).currentRows;
    assert.equal(rows.every((row) => historicalPortfolioWeightAvailable(row)), true);
    for (const row of rows.slice(0, 5)) {
      assert.equal(formatHistoricalPortfolioWeight(row), `${row.weight.toFixed(2)}%`);
      assert.equal(
        row.weight,
        events[0].holdings.find((holding) => holding.ticker === row.ticker).weight,
      );
    }
  }

  // Sized books carry distinct allocations, not one repeated percentage.
  const top100Rows = comparePortfolioEvent(top100Events, top100Events[0]).currentRows;
  assert.ok(new Set(top100Rows.map((row) => row.weight)).size > 50);
  const total = top100Rows.reduce((sum, row) => sum + row.weight, 0);
  assert.ok(Math.abs(total - 100) < 0.01);

  // An equal-weight book is still a real allocation and must not be hidden.
  const equallyWeighted = normalizePortfolioEvents({
    rebalance_log: [{
      signal_date: "2026-09-30",
      execution_date: "2026-10-01",
      type: "scheduled",
      holdings: { MU: 5, TGT: 5 },
      turnover_pct: 10,
      weighting_mode: "equal-weight-proxy",
    }],
  });
  const equalRows = comparePortfolioEvent(equallyWeighted, equallyWeighted[0]).currentRows;
  assert.equal(equalRows.every((row) => historicalPortfolioWeightAvailable(row)), true);
  assert.equal(formatHistoricalPortfolioWeight(equalRows[0]), "5.00%");
});

test("the table opens with the largest position first", () => {
  assert.deepEqual({ ...DEFAULT_HOLDINGS_SORT }, { key: "weight", direction: "desc" });
  const rows = visiblePortfolioRows(
    comparePortfolioEvent(top100Events, top100Events[0]),
    "all",
    "",
  );
  const ordered = sortPortfolioRows(rows, DEFAULT_HOLDINGS_SORT);
  const weights = rows.map((row) => row.weight);
  assert.equal(ordered[0].weight, Math.max(...weights));
  assert.equal(ordered.at(-1).weight, Math.min(...weights));
});

test("columns order the visible rows like the Screener and Portfolio tables", () => {
  const comparison = comparePortfolioEvent(top100Events, top100Events[0]);
  const rows = visiblePortfolioRows(comparison, "all", "");

  const byRank = sortPortfolioRows(rows, { key: "rank", direction: "asc" });
  assert.deepEqual(byRank.map((row) => row.ticker), rows.map((row) => row.ticker));

  const byWeight = sortPortfolioRows(rows, { key: "weight", direction: "desc" });
  assert.equal(byWeight[0].weight, Math.max(...rows.map((row) => row.weight)));
  for (let index = 1; index < byWeight.length; index += 1) {
    assert.ok(byWeight[index - 1].weight >= byWeight[index].weight);
  }
  const ascending = sortPortfolioRows(rows, { key: "weight", direction: "asc" });
  assert.equal(ascending[0].weight, Math.min(...rows.map((row) => row.weight)));

  const byTicker = sortPortfolioRows(rows, { key: "ticker", direction: "asc" });
  assert.deepEqual(
    byTicker.map((row) => row.ticker),
    [...rows.map((row) => row.ticker)].sort((left, right) => left.localeCompare(right)),
  );
  assert.deepEqual(
    sortPortfolioRows(rows, { key: "ticker", direction: "desc" }).map((row) => row.ticker),
    byTicker.map((row) => row.ticker).reverse(),
  );


  // Ordering never drops, duplicates, or invents a row.
  assert.equal(byWeight.length, rows.length);
  assert.equal(new Set(byWeight.map((row) => row.rowIndex)).size, rows.length);
});

test("rows without a weight sink to the bottom in both directions", () => {
  const rows = [
    { ticker: "AAA", weight: 2, rowIndex: 0, statusLabel: "New", sequence: 1 },
    { ticker: "BBB", weight: null, rowIndex: 1, statusLabel: "New", sequence: 2 },
    { ticker: "CCC", weight: 5, rowIndex: 2, statusLabel: "New", sequence: 3 },
  ];
  for (const direction of ["asc", "desc"]) {
    const sorted = sortPortfolioRows(rows, { key: "weight", direction });
    assert.equal(sorted.at(-1).ticker, "BBB");
    assert.equal(sorted.length, 3);
  }
  assert.deepEqual(
    sortPortfolioRows(rows, { key: "unknown-field", direction: "asc" }).map((row) => row.ticker),
    ["AAA", "BBB", "CCC"],
  );
});

test("a genuinely missing weight renders unavailable instead of a zero percent", () => {
  assert.equal(historicalPortfolioWeightAvailable({ weight: 5 }), true);
  assert.equal(historicalPortfolioWeightAvailable({ weight: "2.5" }), true);
  assert.equal(historicalPortfolioWeightAvailable({ weight: null }), false);
  assert.equal(historicalPortfolioWeightAvailable({ weight: "" }), false);
  assert.equal(historicalPortfolioWeightAvailable({ weight: undefined }), false);
  assert.equal(historicalPortfolioWeightAvailable({}), false);
  assert.equal(historicalPortfolioWeightAvailable(null), false);
  assert.equal(formatHistoricalPortfolioWeight({ weight: null }), "—");
});

test("array and object holding records both keep their event weight", () => {
  const events = normalizePortfolioEvents({
    rebalance_log: [{
      signal_date: "2024-09-30",
      execution_date: "2024-10-01",
      type: "initial_formation",
      holdings: [["AAA", 2.5], { ticker: "BBB", portfolio_weight: 7.25 }],
      turnover_pct: 100,
    }],
  });
  const rows = comparePortfolioEvent(events, events[0]).currentRows;
  assert.deepEqual(rows.map((row) => row.ticker), ["AAA", "BBB"]);
  assert.deepEqual(rows.map((row) => row.weight), [2.5, 7.25]);
});

test("removed rows keep the preceding event's mode and its previous weight", () => {
  const events = normalizePortfolioEvents({
    rebalance_log: [
      {
        signal_date: "2024-03-28",
        execution_date: "2024-04-01",
        type: "scheduled",
        holdings: { NEXT: 90 },
        turnover_pct: 10,
        weighting_mode: "score-size",
      },
      {
        signal_date: "2023-09-29",
        execution_date: "2023-10-02",
        type: "initial_formation",
        holdings: { OLD: 100 },
        turnover_pct: 100,
        weighting_mode: "equal-weight-proxy",
      },
    ],
  });
  const comparison = comparePortfolioEvent(events, events[0]);
  assert.equal(comparison.currentRows[0].weightingMode, "score-size");
  assert.equal(comparison.removedRows[0].weightingMode, "equal-weight-proxy");
  assert.equal(comparison.removedRows[0].weight, 100);
  assert.equal(formatHistoricalPortfolioWeight(comparison.removedRows[0]), "100.00%");
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

test("holdings paginate five rows at a time without losing the full filtered set", () => {
  const comparison = comparePortfolioEvent(top100Events, top100Events[0]);
  const rows = visiblePortfolioRows(comparison, "all", "");
  const first = paginatePortfolioRows(rows, 1, PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE);
  const last = paginatePortfolioRows(rows, 20, PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE);
  assert.equal(rows.length, 100);
  assert.equal(first.rows.length, 5);
  assert.equal(first.totalPages, 20);
  assert.equal(last.rows.length, 5);
  assert.equal(last.rangeStart, 96);
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
  assert.equal(top20Events[0].weightingMode, "score-size-proxy");
  assert.equal(top100Events[0].weightingMode, "score-size-proxy");
  for (const events of [top20Events, top100Events]) {
    assert.ok(Math.abs(
      events[0].holdings.reduce((total, row) => total + row.weight, 0) - 100,
    ) < 0.001);
  }
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

test("weight change is expressed in percentage points, not relative change", () => {
  assert.equal(formatWeightChange(1.23), "+1.23 pp");
  assert.equal(formatWeightChange(-0.65), "\u22120.65 pp");
  assert.equal(formatWeightChange(0), "0.00 pp");
  assert.equal(formatWeightChange(7.41), "+7.41 pp");
  assert.equal(formatWeightChange(null), "—");
  assert.equal(formatWeightChange(undefined), "—");
  assert.equal(formatWeightChange(Number.NaN), "—");
  assert.equal(weightChangeTone(1.23), "positive");
  assert.equal(weightChangeTone(-0.65), "negative");
  assert.equal(weightChangeTone(0), "flat");
  assert.equal(weightChangeTone(null), "flat");
  // 6.18 -> 7.41 is +1.23 pp even though it is also +20% in relative terms.
  assert.equal(formatWeightChange(7.41 - 6.18), "+1.23 pp");
});

test("change compares every status against the immediately preceding snapshot", () => {
  const events = normalizePortfolioEvents({
    rebalance_log: [
      {
        signal_date: "2024-09-30",
        execution_date: "2024-10-01",
        type: "scheduled",
        holdings: { UP: 7.41, DOWN: 5.83, SAME: 4, FRESH: 2.5 },
        turnover_pct: 10,
      },
      {
        signal_date: "2024-03-28",
        execution_date: "2024-04-01",
        type: "scheduled",
        holdings: { UP: 6.18, DOWN: 6.48, SAME: 4, GONE: 3.2 },
        turnover_pct: 10,
      },
    ],
  });
  const comparison = comparePortfolioEvent(events, events[0]);
  const byTicker = Object.fromEntries(comparison.currentRows.map((row) => [row.ticker, row]));
  const removed = Object.fromEntries(comparison.removedRows.map((row) => [row.ticker, row]));

  assert.equal(byTicker.UP.status, "retained");
  assert.equal(byTicker.UP.change, 7.41 - 6.18);
  assert.equal(formatWeightChange(byTicker.UP.change), "+1.23 pp");

  assert.equal(byTicker.DOWN.status, "retained");
  assert.equal(formatWeightChange(byTicker.DOWN.change), "\u22120.65 pp");

  assert.equal(byTicker.SAME.status, "retained");
  assert.equal(formatWeightChange(byTicker.SAME.change), "0.00 pp");
  assert.equal(weightChangeTone(byTicker.SAME.change), "flat");

  assert.equal(byTicker.FRESH.status, "new");
  assert.equal(byTicker.FRESH.previousWeight, 0);
  assert.equal(formatWeightChange(byTicker.FRESH.change), "+2.50 pp");

  assert.equal(removed.GONE.status, "removed");
  assert.equal(removed.GONE.weight, 3.2);
  assert.equal(formatWeightChange(removed.GONE.change), "\u22123.20 pp");
  assert.equal(formatHistoricalPortfolioWeight(removed.GONE), "3.20%");
});

test("an initial formation has no change and no previous snapshot", () => {
  const initial = comparePortfolioEvent(top20Events, top20Events.at(-1));
  assert.equal(initial.currentRows.every((row) => row.change === null), true);
  assert.equal(initial.currentRows.every((row) => row.previousWeight === null), true);
  assert.equal(initial.currentRows.every((row) => formatWeightChange(row.change) === "—"), true);
});

test("a scheduled event with no earlier snapshot cannot invent a change", () => {
  const events = normalizePortfolioEvents({
    rebalance_log: [{
      signal_date: "2024-09-30",
      execution_date: "2024-10-01",
      type: "scheduled",
      holdings: { ONLY: 100 },
      turnover_pct: 100,
    }],
  });
  const comparison = comparePortfolioEvent(events, events[0]);
  assert.equal(comparison.currentRows[0].status, "new");
  assert.equal(comparison.currentRows[0].change, null);
  assert.equal(formatWeightChange(comparison.currentRows[0].change), "—");
});

test("a row without a stored weight reports no change instead of a fabricated one", () => {
  assert.equal(formatWeightChange({ weight: 5 }.change), "—");
  assert.equal(weightChangeTone({ weight: 5 }.change), "flat");
});

test("published changes reconcile with the adjacent stored snapshots", () => {
  for (const [events, block] of [[top100Events, top100], [top20Events, top20]]) {
    const comparison = comparePortfolioEvent(events, events[0]);
    const previous = new Map(
      events[1].holdings.map((holding) => [holding.ticker, holding.weight]),
    );
    const current = new Map(
      events[0].holdings.map((holding) => [holding.ticker, holding.weight]),
    );
    for (const row of comparison.currentRows) {
      const expected = row.status === "retained" ? current.get(row.ticker) - previous.get(row.ticker) : current.get(row.ticker);
      assert.ok(Math.abs(row.change - expected) < 1e-9, `${row.ticker} change`);
    }
    for (const row of comparison.removedRows) {
      assert.ok(!current.has(row.ticker));
      assert.ok(Math.abs(row.change + previous.get(row.ticker)) < 1e-9, `${row.ticker} removal`);
    }
    // Every percentage point that leaves one name arrives in another, so the
    // book stays fully invested. Stored weights are rounded to four decimals,
    // which leaves at most a rounding residue here.
    const total = comparison.currentRows.reduce((sum, row) => sum + row.change, 0)
      + comparison.removedRows.reduce((sum, row) => sum + row.change, 0);
    assert.ok(Math.abs(total) < 0.01, `net change ${total}`);
    // The very same numbers survive the export path.
    const exportData = buildPortfolioEvolutionExportData({
      block,
      config: { portfolio: "top100", rebalanceFrequency: "semiannual" },
      selectedEvent: events[0],
      rows: comparison.currentRows,
    });
    assert.equal(exportData.workbookSheets[0].rows[1][3], Number(comparison.currentRows[0].change.toFixed(4)));
  }
});

test("sorting by change orders the movement, with unavailable rows last", () => {
  const rows = visiblePortfolioRows(
    comparePortfolioEvent(top20Events, top20Events[0]),
    "all",
    "",
  );
  const descending = sortPortfolioRows(rows, { key: "change", direction: "desc" });
  for (let index = 1; index < descending.length; index += 1) {
    assert.ok(descending[index - 1].change >= descending[index].change);
  }
  const ascending = sortPortfolioRows(rows, { key: "change", direction: "asc" });
  assert.ok(ascending[0].change <= ascending.at(-1).change);
  assert.equal(descending.length, rows.length);
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
    "Change (pp)",
    "Weight Basis",
    "Status",
    "Signal Date",
    "Execution Date",
  ]);
  assert.equal(holdingsSheet.rows.length, 96);
  assert.equal(holdingsSheet.rows[1][4], "Current Target Weight");
  assert.equal(typeof holdingsSheet.rows[1][3], "number");
  assert.equal(holdingsSheet.rows[1][3], Number(retained[0].change.toFixed(4)));
  assert.equal(holdingsSheet.formats?.[3], EXCEL_FORMAT.changePp);
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
    assert.equal(line.split(",").length, 8);
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
  const component = readFileSync(
    fileURLToPath(new URL("../src/components/PortfolioEvolution.jsx", import.meta.url)),
    "utf8",
  );
  const app = readFileSync(
    fileURLToPath(new URL("../src/App.jsx", import.meta.url)),
    "utf8",
  );
  const tables = readFileSync(
    fileURLToPath(new URL("../src/styles/tables.css", import.meta.url)),
    "utf8",
  );
  const styles = readFileSync(
    fileURLToPath(new URL("../src/styles/backtesting.css", import.meta.url)),
    "utf8",
  );
  assert.ok(page.indexOf("<PerformanceSummary") < page.indexOf("<PortfolioEvolution"));
  assert.doesNotMatch(page, /sidebar[^\n]*Portfolio Evolution/i);
  assert.match(app, /<BacktestingPage hidden=\{page !== "backtesting"\} onSelectStock=\{openStock\}/);
  assert.match(page, /<PortfolioEvolution[\s\S]*?onSelectStock=\{onSelectStock\}/);
  assert.match(component, /className="stock-row"/);
  assert.match(component, /shouldOpenRow\(event\)/);
  assert.match(component, /shouldRouteTickerClick\(event\)/);
  assert.match(component, /href=\{stockPath\(row\.ticker\)\}/);
  assert.match(component, /aria-label=\{stockLinkLabel\(row\.ticker\)\}/);
  assert.doesNotMatch(component, /\/stock\//);
  assert.doesNotMatch(component, /portfolio-evolution__method-note|equal-weight research proxy/i);
  assert.match(component, /historicalPortfolioWeightAvailable\(row\)/);
  assert.match(component, /formatHistoricalPortfolioWeight\(row\)/);
  assert.match(
    component,
    /HOLDINGS_SORT_FIELDS\.map/,
    "every heading must be a sort control driven by the shared field list",
  );
  assert.match(component, /aria-sort=\{sort\.key === key/);
  assert.match(component, /aria-label=\{`Sort by \$\{label\}`\}/);
  assert.ok(
    HOLDINGS_SORT_FIELDS.some((field) => field.label === "Portfolio Weight" && field.slug === "weight"),
    "the weight column must be titled Portfolio Weight",
  );
  assert.match(component, /Historical point-in-time portfolio weight unavailable/);
  assert.match(component, /portfolio-evolution__selected-date-primary/);
  assert.match(component, /portfolio-evolution__holdings-count/);
  assert.match(component, /portfolio-evolution__signal-date/);
  assert.match(component, /<col className="portfolio-evolution__col-rank" \/>/);
  assert.match(component, /<col className="portfolio-evolution__col-ticker" \/>/);
  assert.match(component, /<col className="portfolio-evolution__col-weight" \/>/);
  assert.match(component, /<col className="portfolio-evolution__col-change" \/>/);
  assert.match(component, /<col className="portfolio-evolution__col-status" \/>/);
  assert.match(component, /\{label\}\s*<\/button>/);
  assert.doesNotMatch(component, /comparison\.counts/);
  assert.match(styles, /\.portfolio-evolution__workspace[\s\S]*?align-items: stretch/);
  assert.match(styles, /grid-template-columns: minmax\(0, 0\.88fr\) minmax\(598px, 1\.34fr\)/);
  assert.match(styles, /\.portfolio-evolution__events \{[\s\S]*?overflow: hidden;[\s\S]*?border: 1px solid var\(--color-line\);[\s\S]*?border-radius: 14px/);
  assert.match(styles, /\.portfolio-evolution__event \+ \.portfolio-evolution__event \{\s*border-top: 1px solid var\(--color-line\);\s*\}/);
  assert.match(styles, /\.portfolio-evolution__event \{[\s\S]*?border-left: 4px solid transparent;[\s\S]*?border-radius: 0;[\s\S]*?transition: background-color 160ms ease/);
  assert.match(styles, /\.portfolio-evolution__event\.is-selected \{\s*border-left-color: #EDB900;\s*background: #FFF5D5;\s*\}/);
  assert.doesNotMatch(styles, /\.portfolio-evolution__event:not\(\.is-selected\) \{[^}]*box-shadow/);
  assert.match(styles, /\.portfolio-evolution__holdings-header[\s\S]*?min-height: 104px/);
  assert.match(styles, /\.portfolio-evolution__toolbar[\s\S]*?grid-template-columns: minmax\(216px, 1fr\) auto/);
  assert.match(styles, /\.portfolio-evolution__filters \{[\s\S]*?width: 319px[\s\S]*?grid-template-columns: repeat\(4, 76px\)[\s\S]*?height: 38px[\s\S]*?border: 1px solid var\(--color-line\)[\s\S]*?border-radius: var\(--radius-pill\)/);
  assert.match(styles, /\.portfolio-evolution__filters button \{[\s\S]*?border: 0;[\s\S]*?background: transparent/);
  assert.match(styles, /\.portfolio-evolution__col-rank \{ width: 8%; \}/);
  assert.match(styles, /\.portfolio-evolution__col-ticker \{ width: 19%; \}/);
  assert.match(styles, /\.portfolio-evolution__col-weight \{ width: 28%; \}/);
  assert.match(styles, /\.portfolio-evolution__col-change \{ width: 25%; \}/);
  assert.match(styles, /\.portfolio-evolution__col-status \{ width: 20%; \}/);
  // The company name is gone, so its track and cell rule must be gone too.
  assert.doesNotMatch(styles, /\.portfolio-evolution__col-company/);
  assert.doesNotMatch(styles, /\.portfolio-evolution__company \{/);
  assert.doesNotMatch(component, /portfolio-evolution__col-company/);
  assert.match(styles, /\.portfolio-evolution__weight-heading[\s\S]*?text-align: right/);
  assert.match(styles, /\.portfolio-evolution__status-cell \{\s*padding-left: 12px !important;\s*text-align: left;\s*\}/);
  assert.match(styles, /\.portfolio-evolution__status \{[\s\S]*?width: 78px/);
  assert.match(styles, /\.portfolio-evolution__holdings-table td \{[^}]*border-bottom: 1px solid var\(--color-line\)/s);
  assert.doesNotMatch(
    styles,
    /\.portfolio-evolution__filters button\[aria-pressed="true"\] \{[^}]*font-weight:/,
    "selected and unselected filter states must keep the same font weight",
  );
  assert.match(styles, /\.portfolio-evolution__table-wrap[\s\S]*?overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 1240px\)[\s\S]*?\.portfolio-evolution__workspace \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(tables, /\.portfolio-evolution__holdings-table \.stock-row:hover \{ background: transparent; \}/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { simulateCashflows } from "../src/utils/backtestReport.js";
import { buildBacktestExportData } from "../src/utils/backtestExport.js";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const page = read("../src/BacktestingPage.jsx");
const styles = read("../src/styles/backtesting.css");
const dates = ["2020-01-02", "2020-01-31", "2020-02-03", "2020-02-28"];
const strategy = [100, 100, 100, 100];

function simulate(cashflowDirection) {
  return simulateCashflows({
    dates,
    strategy,
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
    cashflowDirection,
  });
}

test("inflow adds cash and outflow withdraws the same positive configured amount", () => {
  const inflow = simulate("inflow");
  const outflow = simulate("outflow");

  assert.equal(inflow.timeline[2].value, 11_000);
  assert.equal(outflow.timeline[2].value, 9_000);
  assert.equal(inflow.totalContributions, 1_000);
  assert.equal(outflow.totalContributions, -1_000);
  assert.equal(inflow.nominalTotalContributions, 1_000);
  assert.equal(outflow.nominalTotalContributions, -1_000);
  assert.equal(inflow.cashflowDirection, "inflow");
  assert.equal(outflow.cashflowDirection, "outflow");
});

test("cashflow direction is exported in both the cash-flow ledger and settings", () => {
  const data = buildBacktestExportData({
    window: {
      dates: dates.slice(0, 3),
      strategy: strategy.slice(0, 3),
      spy: strategy.slice(0, 3),
      spmo: strategy.slice(0, 3),
      startsAtBacktestOrigin: false,
    },
    block: { end: "2020-02-03" },
    config: {
      startDate: "2020-01-02",
      endDate: "2020-02-03",
      initialCapital: 10_000,
      cashflowEnabled: true,
      contributionAmount: 1_000,
      contributionFrequency: "monthly",
      cashflowDirection: "outflow",
      rebalanceFrequency: "semiannual",
      reinvestDividends: true,
      inflationAdjusted: false,
      includeYtd: true,
      portfolio: "top100",
    },
    exportedAt: "2026-11-14T00:00:00Z",
  });

  const cashFlowSheet = data.workbookSheets.find((sheet) => sheet.name === "Cash Flows");
  assert.deepEqual(cashFlowSheet.rows[0], [
    "Scheduled Date",
    "Actual Cash Inflow",
    "Requested Cash Outflow",
    "Actual Cash Outflow",
    "Unpaid Cash Outflow",
    "Ending Portfolio Balance",
  ]);
  const contributionRow = cashFlowSheet.rows.find((row) => row[0] === "2020-02-03");
  assert.deepEqual(contributionRow.slice(1), [0, 1_000, 1_000, 0, 9_000]);

  const settingsSheet = data.workbookSheets.find((sheet) => sheet.name === "Backtest Settings");
  const settings = new Map(settingsSheet.rows.slice(1));
  assert.equal(settings.get("Cashflow Direction"), "Outflow");
  assert.match(settings.get("Cashflow Settings"), /monthly outflow$/);
  assert.equal(settings.get("Requested Cash Outflows"), 1_000);
  assert.equal(settings.get("Actual Cash Outflows"), 1_000);
  assert.equal(settings.get("Unpaid Cash Outflows"), 0);
});

test("the selector exposes only Inflow and Outflow and preserves the full configuration", () => {
  assert.match(page, /role="group" aria-label="Cashflow direction"/);
  assert.match(page, /\["inflow", "outflow"\]\.map/);
  assert.match(page, /updateDraft\(\{ cashflowDirection: direction \}\)/);
  assert.doesNotMatch(page, /Money In|Money Out|Contribution type|Cashflow subtotal/i);
  assert.match(page, /onChange=\{\(checked\) => updateDraft\(\{ cashflowEnabled: checked \}\)\}/);
  assert.match(page, /data-open=\{draft\.cashflowEnabled \|\| undefined\}/);
  assert.match(page, /cashflowDirection: "inflow"/);
  assert.match(page, /report\.actualOutflows/);
  assert.match(page, /report\.unpaidOutflows/);
});

test("Run Backtest forwards the complete cashflow configuration to the Python engine", () => {
  for (const field of [
    "initial_capital: normalizedDraft.initialCapital",
    "cashflow_enabled: normalizedDraft.cashflowEnabled",
    "cashflow_amount: normalizedDraft.contributionAmount",
    "cashflow_frequency: normalizedDraft.contributionFrequency",
    "cashflow_direction: normalizedDraft.cashflowDirection",
  ]) {
    assert.match(page, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the advanced grid shares explicit top and lower rows across both columns", () => {
  assert.match(
    styles,
    /\.backtest-advanced__grid\s*\{[^}]*"initial reinvest"\s*"cashflows lower"[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
  );
  assert.match(
    styles,
    /\.backtest-advanced__lower-settings\s*\{[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
  );
  assert.match(styles, /\.backtest-cashflow-direction\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.backtest-cashflow-direction__segment\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--color-card\)/s);
});

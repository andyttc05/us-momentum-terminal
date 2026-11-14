import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);
const sectionStart = page.indexOf('<section className="backtest-kpis"');
const sectionEnd = page.indexOf("</section>", sectionStart);
const kpiSection = page.slice(sectionStart, sectionEnd);

test("the backtest summary has exactly four KPI cards in the required order", () => {
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const labels = [...kpiSection.matchAll(/(?<!aria-)label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Start Balance", "End Balance", "Duration", "Total Return"]);
  // The headline return is the same measurement with cashflows on or off.
  assert.doesNotMatch(kpiSection, /Investor Return/);
  assert.equal((kpiSection.match(/<KpiCard\b/g) ?? []).length, 4);
});

test("balance cards use actual report values and keep loading and empty states", () => {
  assert.match(kpiSection, /label="Start Balance"[\s\S]*?value=\{report \? formatMoney\(report\.initialCapital\) : "—"\}/);
  assert.match(kpiSection, /label="End Balance"[\s\S]*?value=\{report \? formatMoney\(report\.finalValue\) : "—"\}/);
  assert.equal((kpiSection.match(/loading=\{resultsLoading\}/g) ?? []).length, 4);
  assert.doesNotMatch(kpiSection, /value="\$[\d,]+"/);
});

test("duration uses the effective report dates and CAGR is no longer a top KPI", () => {
  assert.match(
    kpiSection,
    /label="Duration"[\s\S]*?value=\{formatBacktestDuration\(reportWindow\?\.dates\?\.\[0\], reportWindow\?\.dates\?\.at\(-1\)\)\}/,
  );
  assert.doesNotMatch(kpiSection, /label="CAGR"/);
  assert.match(kpiSection, /value=\{formatPercent\(totalReturn\)\}/);
  assert.doesNotMatch(kpiSection, /Profit \/ Loss|Sharpe Ratio/);
});

test("monetary balances stay neutral while performance figures keep their tone", () => {
  const startCard = kpiSection.slice(
    kpiSection.indexOf('label="Start Balance"'),
    kpiSection.indexOf("<KpiCard", kpiSection.indexOf('label="Start Balance"')),
  );
  const endCard = kpiSection.slice(
    kpiSection.indexOf('label="End Balance"'),
    kpiSection.indexOf("<KpiCard", kpiSection.indexOf('label="End Balance"')),
  );
  assert.doesNotMatch(startCard, /valueTone=/);
  assert.doesNotMatch(endCard, /valueTone=/);
  const durationCard = kpiSection.slice(
    kpiSection.indexOf('label="Duration"'),
    kpiSection.indexOf("<KpiCard", kpiSection.indexOf('label="Duration"')),
  );
  assert.doesNotMatch(durationCard, /valueTone=/);
  assert.match(kpiSection, /valueTone=\{valueTone\(totalReturn\)\}/);
});

test("Performance & Risk puts the headline figures first and the rest in grouped rows", () => {
  const summaryStart = page.indexOf("function PerformanceAndRisk");
  const summaryEnd = page.indexOf("function AdvancedSettings", summaryStart);
  const summary = page.slice(summaryStart, summaryEnd);

  // Four hero figures, then grouped label/value rows instead of many tiles.
  assert.match(summary, /className="backtest-perf-hero"/);
  assert.doesNotMatch(summary, /backtest-metric-tile/);
  assert.match(summary, /className="backtest-perf-columns"/);
  assert.match(summary, /const groups = \[/);

  for (const label of [
    "Duration",
    "CAGR",
    "Sharpe Ratio",
    "Sortino Ratio",
    "Time-Weighted Return",
    "Money-Weighted Return / XIRR",
    "Net Profit / Loss",
    "Return on Capital",
    "Investment Max Drawdown",
    "Account Max Drawdown",
    "Total Cash Inflows",
    "Actual Withdrawals",
    "Unpaid Withdrawals",
    "vs. SPY (Total Return)",
    "Annualized Volatility",
    "Beta vs. SPY",
    "Correlation vs. SPY",
    "Tracking Error vs. SPY",
    "Information Ratio vs. SPY",
    "Beta vs. SPMO",
    "Tracking Error vs. SPMO",
  ]) {
    assert.equal(summary.split(`label: "${label}"`).length - 1, 1, label);
  }
  assert.match(summary, /metrics\?\.benchmarkRelative\?\.spy/);
  assert.match(summary, /metrics\?\.benchmarkRelative\?\.spmo/);
  assert.match(summary, /<Skeleton width="52px" height="12px" \/>/);
  assert.match(page, /<PerformanceAndRisk[\s\S]*?metrics=\{metrics\}[\s\S]*?state=/);
});

test("the monthly performance card and the separate risk card are gone", () => {
  assert.doesNotMatch(page, /MonthlyReturnTable/);
  assert.doesNotMatch(page, /Monthly Performance/);
  assert.doesNotMatch(page, /RiskAnalysis/);
  assert.doesNotMatch(page, /Risk & Benchmark Analysis/);
  assert.match(page, /title="Performance & Risk"/);
  // Annual returns stay: they are the calendar-year view of the same returns.
  assert.match(page, /<AnnualReturnTable/);
});

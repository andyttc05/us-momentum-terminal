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
  const labels = [...kpiSection.matchAll(/<KpiCard\b[\s\S]*?label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Start Balance", "End Balance", "Duration", "Total Return"]);
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
  assert.match(kpiSection, /label="Total Return"[\s\S]*?value=\{formatPercent\(metrics\.totalReturn\)\}/);
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
  assert.match(kpiSection, /label="Total Return"[\s\S]*?valueTone=\{valueTone\(metrics\.totalReturn\)\}/);
});

test("Performance Summary renders all six requested metrics once in compact tiles", () => {
  const summaryStart = page.indexOf("function PerformanceSummary");
  const summaryEnd = page.indexOf("function AdvancedSettings", summaryStart);
  const summary = page.slice(summaryStart, summaryEnd);
  const labels = [
    "Duration",
    "CAGR",
    "Sharpe Ratio",
    "Time-Weighted Return",
    "Money-Weighted Return / XIRR",
    "vs. SPY (Total Return)",
  ];
  for (const label of labels) {
    assert.equal(summary.split(`label: "${label}"`).length - 1, 1);
  }
  assert.match(summary, /className="backtest-metric-tile"/);
  assert.match(summary, /performanceMetrics\.map/);
  assert.match(summary, /<Skeleton width="72px" height="16px" \/>/);
  assert.match(page, /<PerformanceSummary[\s\S]*?metrics=\{metrics\}[\s\S]*?state=/);
});

test("risk analysis exposes Sortino and benchmark-relative metrics from the shared window", () => {
  const riskStart = page.indexOf("function RiskAnalysis");
  const riskEnd = page.indexOf("function AdvancedSettings", riskStart);
  const risk = page.slice(riskStart, riskEnd);
  for (const label of [
    "Annualized Volatility",
    "Sortino Ratio",
    "Beta vs. SPY",
    "Correlation vs. SPY",
    "Tracking Error vs. SPY",
    "Information Ratio vs. SPY",
    "Beta vs. SPMO",
    "Tracking Error vs. SPMO",
  ]) {
    assert.equal(risk.split(`label: "${label}"`).length - 1, 1);
  }
  assert.match(risk, /metrics\?\.benchmarkRelative\?\.spy/);
  assert.match(risk, /metrics\?\.benchmarkRelative\?\.spmo/);
  assert.match(page, /<MonthlyReturnTable[\s\S]*?rows=\{report\?\.monthlyRows \?\? \[\]\}/);
  assert.match(page, /<RiskAnalysis[\s\S]*?metrics=\{metrics\}/);
});

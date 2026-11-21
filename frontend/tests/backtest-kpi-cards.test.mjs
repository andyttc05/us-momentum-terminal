import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);
const styles = readFileSync(
  fileURLToPath(new URL("../src/styles/backtesting.css", import.meta.url)),
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
  // The headline return is profit over committed capital, and a closed account
  // reports N/A instead of a positive number beside a $0 balance.
  assert.match(kpiSection, /value=\{totalReturnLabel\}/);
  assert.match(page, /const totalReturnLabel = report\?\.fullyDepleted \? "N\/A" : formatPercent\(totalReturn\);/);
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
  // A closed account keeps the neutral tone rather than a green/red one.
  assert.match(kpiSection, /valueTone=\{report\?\.fullyDepleted \? "" : valueTone\(totalReturn\)\}/);
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
    "Investment Max Drawdown",
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

test("Performance & Risk stacks strategy groups in one column and benchmarks in the other", () => {
  const summaryStart = page.indexOf("function PerformanceAndRisk");
  const summaryEnd = page.indexOf("function AdvancedSettings", summaryStart);
  const summary = page.slice(summaryStart, summaryEnd);

  // Two columns of stacked groups: Return and Risk on the left, Benchmarks on
  // the right. A fourth column used to hold a single cash-flow row and left a
  // tall empty gap beneath it.
  assert.match(summary, /const perfColumns = \[/);
  assert.match(summary, /visibleGroups\.filter\(\(group\) => group\.title !== "Benchmarks"\)/);
  assert.match(summary, /visibleGroups\.filter\(\(group\) => group\.title === "Benchmarks"\)/);
  // A disabled cash-flow run leaves one row, which rendered as a heading with
  // nothing under it. The group is dropped and the state moves to the footer.
  assert.match(summary, /group\.rows\.length > 1/);
  assert.match(summary, /\{ label: "Cash Flows", value: config\?\.cashflowEnabled \? "Scheduled" : "Disabled" \}/);
  assert.match(summary, /className="backtest-perf-column"/);
  // The groups render through the two-column split, never a flat four-up list.
  assert.match(summary, /perfColumns\.map\(/);
  assert.doesNotMatch(summary, /\{groups\.map\(/);
});

test("Performance & Risk keeps two balanced columns and collapses to one on narrow screens", () => {
  assert.match(
    styles,
    /\.backtest-perf-columns \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1\.12fr\) minmax\(0, 1fr\);/,
  );
  assert.match(styles, /\.backtest-perf-column \{\s*display: grid;/);
  // Tablet keeps the two columns. Dissolving the wrappers so the groups flowed
  // two-up left an empty cell once the cash-flow group stopped rendering.
  assert.match(
    styles,
    /@media \(max-width: 1100px\) \{[\s\S]*?\.backtest-perf-columns \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 0 30px; \}/,
  );
  assert.doesNotMatch(styles, /\.backtest-perf-column \{ display: contents; \}/);
  // Phone: one column of groups.
  assert.match(
    styles,
    /@media \(max-width: 600px\) \{[\s\S]*?\.backtest-perf-columns \{ grid-template-columns: minmax\(0, 1fr\); gap: 18px 0; \}/,
  );
  // Four narrow columns are gone for good: the one-row cash-flow column was
  // what left the empty hole this layout replaces.
  assert.doesNotMatch(
    styles,
    /\.backtest-perf-columns \{\s*display: grid;\s*grid-template-columns: repeat\(4,/,
  );
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

test("the Advanced Settings band is inset from the card edge with room above it", () => {
  // The full-bleed hairline sat 4px under the date inputs and read as a cramped
  // seam. It is now inset to the card padding, with the form keeping its air.
  const band = styles.slice(
    styles.indexOf(".backtest-advanced::before"),
    styles.indexOf("}", styles.indexOf(".backtest-advanced__title")),
  );
  assert.match(
    styles,
    /\.backtest-advanced::before \{\s*position: absolute;\s*top: 0;\s*right: 19px;\s*left: 19px;\s*height: 1px;\s*background: var\(--color-line\);/,
  );
  assert.match(band, /min-height: 54px;/);
  // No full-bleed border on the toggle any more.
  assert.doesNotMatch(styles, /\.backtest-advanced__toggle \{[\s\S]{0,220}?border-top: 1px solid/);
  assert.match(styles, /\.backtest-config \{[\s\S]{0,260}?padding: 16px 19px 15px;/);
});

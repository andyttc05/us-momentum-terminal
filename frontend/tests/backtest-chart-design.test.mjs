import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);

test("the cumulative chart uses the approved concise legend labels", () => {
  assert.match(page, /\{ id: "strategy", name: "Strategy", color: "#FFC83D" \}/);
  assert.doesNotMatch(page, /US Momentum Strategy/);
});

test("each chart view plots its own account series", () => {
  assert.match(page, /const values = isPercent \? entry\?\.capitalReturns : entry\?\.values;/);
  assert.match(page, /\.filter\(\(series\) => series\.values\.length === dates\.length\)/);
  assert.match(page, /wealthPosition\(value, scale, top, plotHeight\)/);
  assert.match(page, /percentScale\(allValues\)/);
  assert.doesNotMatch(page, /window\[series\.id\]\.map\(\(value\) => value - 100\)/);
  // Two views, both fed by the shared simulation.
  assert.match(page, /\{ id: "value", label: "Portfolio Value" \}/);
  assert.match(page, /\{ id: "capital", label: "Return on Capital" \}/);
  assert.match(page, /const \[chartView, setChartView\] = useState\("value"\);/);
  // Log scale is a dollar-axis feature; the percentage view hides the switch.
  assert.match(page, /\{chartView === "value" && \(/);
});

test("the plot has no redundant cumulative-return caption", () => {
  const chartStart = page.indexOf("function CumulativeChart");
  const chartEnd = page.indexOf("function DrawdownChart", chartStart);
  const cumulativeChart = page.slice(chartStart, chartEnd);
  assert.doesNotMatch(cumulativeChart, /backtest-axis-caption/);
  assert.doesNotMatch(page, />Cumulative return \(%\)</);
});

test("the chart tooltip renders a dated balance and capital-return column per series", () => {
  const tooltipStart = page.indexOf("function CumulativeTooltip");
  const tooltipEnd = page.indexOf("function LogScaleToggle", tooltipStart);
  const tooltip = page.slice(tooltipStart, tooltipEnd);
  assert.match(tooltip, /formatTooltipMoney\(portfolioValue\)/);
  assert.match(tooltip, /formatPercent\(capitalReturn\)/);
  assert.match(tooltip, /values\?\.capitalReturns\?\.\[index\]/);
  assert.match(tooltip, /SERIES\.map/);
  assert.doesNotMatch(tooltip, /\$46,370|363\.7%/);
});

test("final return labels render independently of hover and are reserved from the tooltip", () => {
  assert.match(page, /endLabels\.map\([\s\S]*?data-testid=\{`backtest-final-label-\$\{series\.id\}`\}/);
  assert.match(page, /rightBoundary: labelBoundary/);
  assert.doesNotMatch(page, /selectedPoint && \([\s\S]{0,120}endLabels\.map/);
});

test("the cumulative tooltip is a compact three-column card", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../src/styles/backtesting.css", import.meta.url)),
    "utf8",
  );
  const tooltip = css.slice(
    css.indexOf(".backtest-chart-tooltip {"),
    css.indexOf(".backtest-chart-tooltip--compact"),
  );
  assert.match(tooltip, /width: 272px/);
  assert.match(tooltip, /min-height: 116px/);
  // dot + fixed name column + auto money column + flexible right-aligned return
  assert.match(tooltip, /grid-template-columns: 9px 64px max-content minmax\(52px, 1fr\)/);
  assert.match(tooltip, /column-gap: 10px/);
  assert.match(tooltip, /\.backtest-chart-tooltip__portfolio \{ text-align: right; \}/);
  assert.match(tooltip, /\.backtest-chart-tooltip__return \{[\s\S]*?text-align: right/);
  assert.doesNotMatch(tooltip, /minmax\(78px, auto\)/);
  assert.match(page, /const CHART_TOOLTIP = \{ width: 272, height: 116 \};/);
});

test("the tooltip is offset from the crosshair and never covers the end labels", () => {
  const tooltip = readFileSync(
    fileURLToPath(new URL("../src/utils/priceTooltip.js", import.meta.url)),
    "utf8",
  );
  assert.match(tooltip, /export const CHART_TOOLTIP_GAP = 24;/);
  assert.match(tooltip, /export const CHART_TOOLTIP_MARGIN = 12;/);
  assert.match(page, /const labelBoundary = left \+ plotWidth \+ pillOffset;/);
  assert.match(page, /rightBoundary: labelBoundary/);
});

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

test("the plot has no redundant cumulative-return caption", () => {
  const chartStart = page.indexOf("function CumulativeChart");
  const chartEnd = page.indexOf("function DrawdownChart", chartStart);
  const cumulativeChart = page.slice(chartStart, chartEnd);
  assert.doesNotMatch(cumulativeChart, /backtest-axis-caption/);
  assert.doesNotMatch(page, />Cumulative return \(%\)</);
});

test("the cumulative tooltip renders dated balance and return columns for every series", () => {
  const tooltipStart = page.indexOf("function CumulativeTooltip");
  const tooltipEnd = page.indexOf("function LogScaleToggle", tooltipStart);
  const tooltip = page.slice(tooltipStart, tooltipEnd);
  assert.match(tooltip, /formatTooltipMoney\(portfolioValue\)/);
  assert.match(tooltip, /formatPercent\(cumulativeReturn\)/);
  assert.match(tooltip, /SERIES\.map/);
  assert.doesNotMatch(tooltip, /\$46,370|363\.7%/);
});

test("final return labels render independently of hover and are reserved from the tooltip", () => {
  assert.match(page, /endLabels\.map\([\s\S]*?data-testid=\{`backtest-final-label-\$\{series\.id\}`\}/);
  assert.match(page, /rightBoundary: labelBoundary/);
  assert.doesNotMatch(page, /selectedPoint && \([\s\S]{0,120}endLabels\.map/);
});

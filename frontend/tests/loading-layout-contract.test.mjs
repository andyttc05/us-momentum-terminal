import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const overview = source("../src/OverviewPage.jsx");
const screener = source("../src/ScreenerPage.jsx");
const portfolio = source("../src/PortfolioPage.jsx");
const backtesting = source("../src/BacktestingPage.jsx");
const stockAnalysis = source("../src/StockAnalysisPage.jsx");

test("every primary page renders its structural shell without a data early return", () => {
  for (const page of [overview, screener, portfolio, backtesting, stockAnalysis]) {
    assert.doesNotMatch(page, /if\s*\(\s*(?:!data|status\s*===\s*["']loading["'])\s*\)\s*return/);
    assert.match(page, /return\s*\(/);
  }
});

test("Screener keeps controls and complete table structure during loading", () => {
  assert.match(screener, /className="screener-scope"/);
  assert.match(screener, /className="screener-search"/);
  assert.match(screener, /Filters/);
  assert.match(screener, /<ExportMenu[\s\S]*?ariaLabel="Export current Screener results"/);
  assert.match(screener, /<thead>/);
  assert.match(screener, /<TableSkeletonRows columns=\{columnCount\} rows=\{rowsPerPage\}/);
  assert.match(screener, /<Pagination/);
});

test("KPI and chart cards use shared placeholders instead of disappearing", () => {
  for (const page of [overview, portfolio, backtesting]) {
    assert.match(page, /<KpiCard[\s\S]*?loading=|loading=\{/);
  }
  assert.match(overview, /<ChartState/);
  assert.match(backtesting, /<ChartState/);
  assert.match(stockAnalysis, /<ChartState/);
});

test("Backtesting keeps the results and tables mounted in every state", () => {
  assert.match(backtesting, /className="backtest-results"/);
  assert.match(backtesting, /<AnnualReturnTable[\s\S]*state=/);
  assert.match(backtesting, /<PerformanceSummary[\s\S]*state=/);
  assert.match(backtesting, /<TableSkeletonRows columns=\{4\}/);
  assert.doesNotMatch(backtesting, /"Data update failed", "error", undefined, "refresh-error"/);
});

test("Stock Analysis keeps returns, summary, and ranking cards in its shell", () => {
  assert.match(stockAnalysis, /className="stock-price-summary"/);
  assert.match(stockAnalysis, /className="stock-returns-card"/);
  assert.match(stockAnalysis, /title="Momentum Analysis"/);
  assert.match(stockAnalysis, /title="Ranking History"/);
  assert.doesNotMatch(stockAnalysis, /stock-returns-card[^>]*hidden=/);
});

test("Portfolio constraints stay unevaluated until results exist", () => {
  assert.match(portfolio, /Not evaluated/);
  assert.match(portfolio, /<TableSkeletonRows columns=\{columnCount\} rows=\{rowsPerPage\}/);
  assert.match(portfolio, /<Pagination/);
});

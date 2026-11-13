import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const backtesting = source("../src/BacktestingPage.jsx");
const screener = source("../src/ScreenerPage.jsx");
const portfolio = source("../src/PortfolioPage.jsx");
const appCss = source("../src/styles/app.css");
const backtestingCss = source("../src/styles/backtesting.css");

test("the yellow inline warning banner is gone", () => {
  assert.doesNotMatch(backtesting, /backtest-results-outdated/);
  assert.doesNotMatch(backtestingCss, /backtest-results-outdated/);
  assert.doesNotMatch(backtestingCss, /#FFF9E8/);
  assert.doesNotMatch(backtesting, /data-outdated=/);
});

test("every page reports through the one black notification card", () => {
  for (const page of [backtesting, screener, portfolio]) {
    assert.match(page, /<Toast[\s\S]*?className="page-toast"/);
    assert.doesNotMatch(page, /className="[^"]*banner/);
    assert.doesNotMatch(page, /role="alert"[^>]*>[\s\S]{0,80}warning/i);
  }
});

test("only one notification can be on screen at a time", () => {
  // A page toast suppresses the shared data-state toast.
  assert.match(appCss, /\.app-shell:has\(\.page-toast\) > \.status-toast \{ display: none; \}/);
  // Per page, a single resolved notification is rendered.
  assert.match(backtesting, /\{notification && \(/);
  assert.equal((backtesting.match(/<Toast\b/g) ?? []).length, 1);
  assert.equal((screener.match(/<Toast\b/g) ?? []).length, 1);
  assert.equal((portfolio.match(/<Toast\b/g) ?? []).length, 1);
});

test("changing the pending configuration never raises a notification", () => {
  // Universe and rebalance changes only update the draft; no stale-result
  // banner or toast is left to reappear on render.
  assert.doesNotMatch(backtesting, /backtest-outdated/);
  assert.doesNotMatch(backtesting, /dismissedOutdatedKey/);
  assert.doesNotMatch(backtesting, /kind: "partial"/);
  assert.doesNotMatch(backtesting, /displayNotification/);

  const updateDraft = backtesting.slice(
    backtesting.indexOf("function updateDraft"),
    backtesting.indexOf("function selectBacktestUniverse"),
  );
  assert.doesNotMatch(updateDraft, /setNotification/);

  const selectBacktestUniverse = backtesting.slice(
    backtesting.indexOf("function selectBacktestUniverse"),
    backtesting.indexOf("function showNotification"),
  );
  assert.doesNotMatch(selectBacktestUniverse, /setNotification|showNotification/);
});

test("a settings change never starts a backtest on its own", () => {
  const runBacktest = backtesting.slice(
    backtesting.indexOf("async function runBacktest"),
    backtesting.indexOf("async function refreshPreview"),
  );
  // The only entry point into the backend call is the explicit click handler.
  assert.equal((backtesting.match(/executeBacktest\(/g) ?? []).length, 1);
  assert.match(runBacktest, /if \(!canRun \|\| isRunning\) return;/);
  assert.match(backtesting, /onClick=\{runBacktest\}/);
});

test("export and failure messages use the shared concise wording", () => {
  for (const page of [backtesting, screener, portfolio]) {
    assert.match(page, /Export (completed|failed)/);
  }
  assert.doesNotMatch(backtesting, /Excel workbook downloaded|CSV export downloaded/);
});

test("important errors stay until dismissed and keep the Retry action", () => {
  assert.match(backtesting, /durationMs: undefined/);
  assert.match(backtesting, /notification-toast__action/);
  assert.match(backtesting, /retry === "backtest" \? runBacktest : refreshPreview/);
  assert.match(
    backtesting,
    /showNotification\("Missing price history", "error", undefined, "missing-data", true\)/,
  );
});

test("notifications stay above the mobile navigation", () => {
  assert.match(appCss, /--toast-edge-bottom: calc\(var\(--mobile-nav-gap\) \+ var\(--mobile-nav-height\) \+ 12px\);/);
  assert.match(appCss, /--mobile-nav-height: 66px/);
  const mobile = appCss.slice(appCss.indexOf("@media (max-width: 767px)"));
  assert.match(mobile, /\.notification-toast \{[\s\S]*?bottom: var\(--toast-edge-bottom\)/);
});

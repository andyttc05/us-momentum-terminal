import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REBALANCE_FREQUENCY,
  REBALANCE_OPTIONS,
  isRebalanceFrequency,
  rebalanceLabel,
  rebalanceSummaryLabel,
} from "../src/utils/rebalanceFrequency.js";

const page = readFileSync(fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)), "utf8");
const provider = readFileSync(fileURLToPath(new URL("../src/api/MarketProvider.jsx", import.meta.url)), "utf8");
const client = readFileSync(fileURLToPath(new URL("../src/api/client.js", import.meta.url)), "utf8");
const pagesWorkflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/deploy-pages.yml", import.meta.url)),
  "utf8",
);

test("rebalancing exposes only the four supported schedules and defaults to semiannual", () => {
  assert.equal(DEFAULT_REBALANCE_FREQUENCY, "semiannual");
  assert.deepEqual(
    REBALANCE_OPTIONS.map((option) => option.value),
    ["monthly", "quarterly", "semiannual", "annual"],
  );
  assert.deepEqual(
    REBALANCE_OPTIONS.map((option) => option.label),
    [
      "Monthly (Every Month)",
      "Quarterly (Mar / Jun / Sep / Dec)",
      "Semiannual (Mar / Sep)",
      "Annual (September)",
    ],
  );
  assert.equal(rebalanceLabel("quarterly"), "Quarterly (Mar / Jun / Sep / Dec)");
  assert.equal(rebalanceSummaryLabel("annual"), "Annual");
  assert.equal(isRebalanceFrequency("weekly"), false);
});

test("the dropdown is controlled, interactive and reflected in both summaries", () => {
  assert.match(page, /value=\{draft\.rebalanceFrequency\}/);
  assert.match(page, /options=\{REBALANCE_OPTIONS\}/);
  assert.match(page, /updateDraft\(\{ rebalanceFrequency: event\.target\.value \}\)/);
  assert.doesNotMatch(page, /value="semiannual"[\s\S]{0,160}disabled/);
  assert.match(page, /Rebalance: \$\{rebalanceSummaryLabel\(draft\.rebalanceFrequency\)\}/);
  assert.match(page, /value: config \? rebalanceLabel\(config\.rebalanceFrequency\)/);
});

test("Run Backtest sends the latest frequency to live or published data", () => {
  assert.match(page, /rebalance_frequency: normalizedDraft\.rebalanceFrequency/);
  assert.match(page, /await executeBacktest\(/);
  assert.match(page, /setCustomRun\(\{ key, block \}\)/);
  assert.match(page, /Backtest results use \$\{rebalanceLabel\(submittedConfig\.rebalanceFrequency\)\}/);
  assert.match(page, /current\?\.id === "backtest-complete" \? null : current/);
  assert.match(provider, /const usesPublishedRange = Boolean/);
  assert.match(provider, /if \(usesPublishedRange && frequency === "semiannual"\)/);
  assert.match(provider, /return api\.backtest\(config\)/);
  assert.match(provider, /api\.backtestSchedule\(config\.portfolio, frequency\)/);
  assert.match(client, /VITE_BACKTEST_API_BASE_URL/);
  assert.match(client, /base: BACKTEST_API_BASE/);
  assert.match(
    pagesWorkflow,
    /VITE_BACKTEST_API_BASE_URL: https:\/\/us-momentum-data\.onrender\.com\/api/,
  );
});

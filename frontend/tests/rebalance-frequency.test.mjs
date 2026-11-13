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

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const page = read("../src/BacktestingPage.jsx");
const provider = read("../src/api/MarketProvider.jsx");

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

test("the dropdown is controlled and both summaries reflect the selection", () => {
  assert.match(page, /value=\{draft\.rebalanceFrequency\}/);
  assert.match(page, /REBALANCE_OPTIONS\.map/);
  assert.match(page, /updateDraft\(\{ rebalanceFrequency: event\.target\.value \}\)/);
  assert.match(page, /Rebalance: \$\{rebalanceSummaryLabel\(draft\.rebalanceFrequency\)\}/);
  assert.match(page, /config \? rebalanceLabel\(config\.rebalanceFrequency\)/);
});

test("Run Backtest forwards the latest frequency and can use published schedules", () => {
  assert.match(page, /rebalance_frequency: normalizedDraft\.rebalanceFrequency/);
  assert.match(page, /await executeBacktest\(/);
  assert.match(page, /Results still use \$\{rebalanceLabel\(submittedConfig\.rebalanceFrequency\)\}/);
  assert.match(provider, /api\.backtest\(config\)/);
  assert.match(provider, /backtestSchedules\?\.\[config\.portfolio\]\?\.\[frequency\]/);
});

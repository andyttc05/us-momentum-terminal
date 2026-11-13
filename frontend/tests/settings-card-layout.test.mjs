import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const backtesting = read("../src/styles/backtesting.css");
const components = read("../src/styles/components.css");
const page = read("../src/BacktestingPage.jsx");

test("Advanced Settings uses independent shared cards in two balanced columns", () => {
  assert.match(backtesting, /\.backtest-advanced__grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(backtesting, /\.backtest-advanced__grid\s*\{[^}]*align-items:\s*stretch/s);
  assert.match(page, /<SettingsCard[\s\S]*title="Initial Capital"/);
  assert.match(page, /<SettingsCard[\s\S]*title="Cashflows"/);
  assert.equal((page.match(/<SettingsRow/g) ?? []).length, 4);
});

test("settings rows do not reintroduce divider-based layout", () => {
  assert.doesNotMatch(backtesting, /\.backtest-advanced-panel\s*\+\s*\.backtest-advanced-panel/);
  assert.doesNotMatch(backtesting, /\.backtest-advanced__settings[^{]*\{[^}]*border-(top|bottom)/s);
});

test("dropdown arrows use the shared inset and vertical centring", () => {
  assert.match(components, /\.dropdown-control__arrow\s*\{[^}]*right:\s*var\(--dropdown-arrow-inset\)[^}]*transform:\s*translateY\(-50%\)/s);
  assert.match(components, /\.dropdown-control select\s*\{[^}]*padding:\s*0 calc\(var\(--dropdown-arrow-inset\) \+ 28px\) 0 16px/s);
});

test("capital and rebalancing labels have narrow-width stacking rules", () => {
  assert.match(backtesting, /\.backtest-capital-card \.settings-card__title h3\s*\{\s*white-space:\s*nowrap/);
  assert.match(backtesting, /\.backtest-rebalance-row \.settings-card__header\s*\{[^}]*flex-direction:\s*column/s);
});

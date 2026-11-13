import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPortfolioCsv } from "../src/utils/portfolioExport.js";
import { evaluatePortfolioConstraints } from "../src/utils/portfolioConstraints.js";
import {
  DEFAULT_UNIVERSE,
  UNIVERSE_OPTIONS,
  UNIVERSE_STORAGE_KEY,
  holdingCountForUniverse,
  normalizeUniverse,
  portfolioForUniverse,
  readUniverseSelection,
  writeUniverseSelection,
} from "../src/utils/universeState.js";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const publication = JSON.parse(source("../public/data/publication.json"));

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key),
  };
}

test("universe labels and holding counts are exact and shared", () => {
  assert.deepEqual(
    UNIVERSE_OPTIONS.map(({ label }) => label),
    ["Top 100", "Top 20"],
  );
  assert.equal(normalizeUniverse("top20"), "top20");
  assert.equal(normalizeUniverse("unknown"), DEFAULT_UNIVERSE);
  assert.equal(holdingCountForUniverse("top100"), 100);
  assert.equal(holdingCountForUniverse("top20"), 20);
});

test("universe selection persists through the one storage key", () => {
  const storage = memoryStorage({
    [UNIVERSE_STORAGE_KEY]: "top20",
  });
  assert.equal(readUniverseSelection(storage), "top20");
  assert.equal(writeUniverseSelection("top100", storage), true);
  assert.equal(storage.value(UNIVERSE_STORAGE_KEY), "top100");
  assert.equal(readUniverseSelection(storage), "top100");
});

test("portfolio selection never falls back from a missing Top 20 book to Top 100", () => {
  const top100 = { holdings: Array.from({ length: 100 }, () => ({})) };
  const top20 = { holdings: Array.from({ length: 20 }, () => ({})) };
  assert.equal(portfolioForUniverse({ portfolio: top100, portfolios: { top100, top20 } }, "top20"), top20);
  assert.equal(portfolioForUniverse({ portfolio: top100 }, "top100"), top100);
  assert.equal(portfolioForUniverse({ portfolio: top100 }, "top20"), null);
});

for (const [universe, expectedCount] of [["top100", 100], ["top20", 20]]) {
  test(`${universe} portfolio has ${expectedCount} holdings, full allocation and consistent allocations`, () => {
    const portfolio = portfolioForUniverse(publication, universe);
    assert.ok(portfolio?.available, `${universe} portfolio availability`);
    assert.equal(portfolio.holdings.length, expectedCount);
    assert.equal(portfolio.summary.totalHoldings, expectedCount);
    assert.ok(Math.abs(portfolio.holdings.reduce((sum, holding) => sum + holding.finalWeight, 0) - 100) <= 0.01);
    assert.ok(Math.abs(portfolio.sectors.reduce((sum, sector) => sum + sector.value, 0) - 100) <= 0.01);

    const evaluation = evaluatePortfolioConstraints(portfolio.holdings, expectedCount);
    assert.equal(evaluation.evaluated, true);
    assert.deepEqual(
      evaluation.constraints.map(({ rule }) => rule),
      ["≤ 9%", "≤ 35%", `= ${expectedCount}`, "= 100%"],
    );
    assert.ok(evaluation.constraints.every(({ status }) => status === "passed"));

    const csvLines = buildPortfolioCsv(portfolio.holdings).split("\r\n");
    assert.equal(csvLines.length, expectedCount + 1);
  });
}

test("Backtesting is the only page with a universe control and both pages read one shared state", () => {
  const app = source("../src/App.jsx");
  const backtesting = source("../src/BacktestingPage.jsx");
  const portfolio = source("../src/PortfolioPage.jsx");
  assert.match(app, /<UniverseProvider>[\s\S]*<MarketProvider>/);
  assert.match(app, /<RouterProvider>[\s\S]*<UniverseProvider>/);
  assert.match(backtesting, /const \{ universe, selectUniverse \} = useUniverse\(\)/);
  assert.match(portfolio, /const \{ universe \} = useUniverse\(\)/);
  assert.match(backtesting, /universe !== submittedConfig\.portfolio/);
  assert.match(backtesting, /backtest-results-outdated/);
  assert.doesNotMatch(portfolio, /selectUniverse|aria-label="Portfolio selection"/);
});

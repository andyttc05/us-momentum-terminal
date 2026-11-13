import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPortfolioCsv } from "../src/utils/portfolioExport.js";
import { evaluatePortfolioConstraints } from "../src/utils/portfolioConstraints.js";
import { buildScreenerExportData } from "../src/utils/screenerExport.js";
import {
  ACTIVE_UNIVERSE_STORAGE_KEY,
  DEFAULT_UNIVERSE,
  UNIVERSE_OPTIONS,
  UNIVERSE_STORAGE_KEY,
  datasetForUniverse,
  holdingCountForUniverse,
  normalizeUniverse,
  portfolioForUniverse,
  readActiveUniverse,
  readUniverseSelection,
  targetHoldingsForDataset,
  writeActiveUniverse,
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
  assert.deepEqual(
    UNIVERSE_OPTIONS.map(({ value }) => value),
    ["top100", "top20"],
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

test("the active dataset universe persists separately from the pending selection", () => {
  const storage = memoryStorage({
    [UNIVERSE_STORAGE_KEY]: "top100",
    [ACTIVE_UNIVERSE_STORAGE_KEY]: "top20",
  });
  assert.equal(readUniverseSelection(storage), "top100");
  assert.equal(readActiveUniverse(DEFAULT_UNIVERSE, storage), "top20");
  writeActiveUniverse("top100", storage);
  assert.equal(readActiveUniverse(DEFAULT_UNIVERSE, storage), "top100");
  assert.equal(readUniverseSelection(storage), "top100");
  // Without a stored dataset the selection is the safest starting point.
  assert.equal(readActiveUniverse("top20", memoryStorage()), "top20");
});

test("dataset resolution keeps every page on one universe's selection", () => {
  for (const [universe, expectedCount] of [["top100", 100], ["top20", 20]]) {
    const dataset = datasetForUniverse(publication, universe);
    assert.equal(dataset.universe, universe);
    assert.equal(dataset.meta.universe, universe);
    assert.equal(dataset.meta.targetHoldings, expectedCount);
    assert.equal(dataset.meta.status, "success");
    assert.ok(dataset.meta.calculationDate, "calculation date");
    assert.ok(dataset.meta.dataTimestamp, "data timestamp");
    assert.ok(dataset.meta.runId, "run identifier");
    assert.equal(dataset.stocks.length, expectedCount);
    assert.equal(dataset.stockTickers.length, expectedCount);
    assert.equal(targetHoldingsForDataset(dataset, universe), expectedCount);

    const holdingTickers = new Set(dataset.portfolio.holdings.map((holding) => holding.ticker));
    assert.deepEqual(new Set(dataset.stockTickers), holdingTickers);
    assert.ok(dataset.stocks.every((stock) => holdingTickers.has(stock.ticker)));
    // Ranks are the real cross-sectional ranks, in order.
    const ranks = dataset.stocks.map((stock) => stock.rank);
    assert.deepEqual(ranks, [...ranks].sort((left, right) => left - right));
  }
});

test("the two datasets never share rows or performance", () => {
  const top100 = datasetForUniverse(publication, "top100");
  const top20 = datasetForUniverse(publication, "top20");
  const top100Tickers = new Set(top100.stockTickers);
  assert.ok(top20.stockTickers.every((ticker) => top100Tickers.has(ticker)));
  assert.notEqual(
    top100.overview.performance.All.series[0].values.at(-1),
    top20.overview.performance.All.series[0].values.at(-1),
  );
  assert.notEqual(
    top100.overview.sectorAllocation.map((row) => row.name).join("|"),
    top20.overview.sectorAllocation.map((row) => row.name).join("|"),
  );
});

test("a publication without datasets only serves its own Top 100 scope", () => {
  const legacy = { overview: publication.overview, stocks: publication.stocks, portfolio: publication.portfolio };
  assert.equal(datasetForUniverse(legacy, "top20"), null);
  assert.ok(datasetForUniverse(legacy, "top100").stocks.length > 0);
  assert.equal(portfolioForUniverse(legacy, "top20"), null);
});

test("portfolio selection never falls back from a missing Top 20 book to Top 100", () => {
  const top100 = { holdings: Array.from({ length: 100 }, () => ({})) };
  const top20 = { holdings: Array.from({ length: 20 }, () => ({})) };
  assert.equal(portfolioForUniverse({ portfolios: { top100, top20 } }, "top20"), top20);
  assert.equal(portfolioForUniverse({ portfolio: top100 }, "top100"), top100);
  assert.equal(portfolioForUniverse({ portfolio: top100 }, "top20"), null);
});

for (const [universe, expectedCount] of [["top100", 100], ["top20", 20]]) {
  test(`${universe} dataset has ${expectedCount} holdings, full allocation and consistent allocations`, () => {
    const dataset = datasetForUniverse(publication, universe);
    const portfolio = dataset.portfolio;
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

    assert.equal(dataset.overview.snapshot.portfolioStocks, String(expectedCount));
    assert.equal(dataset.overview.topMomentum.length, 5);
    assert.ok(
      dataset.overview.topMomentum.every((row) => dataset.stockTickers.includes(row.ticker)),
      "Top Momentum rows come from the dataset",
    );

    // Exports always describe the whole dataset, never a pagination page.
    const csvLines = buildPortfolioCsv(portfolio.holdings).split("\r\n");
    assert.equal(csvLines.length, expectedCount + 1);

    const screener = buildScreenerExportData({
      stocks: dataset.stocks,
      universe,
      filters: {},
      search: "",
      meta: publication.meta,
    });
    assert.equal(screener.rowCount, expectedCount);
    assert.equal(screener.csv.split("\r\n").length, expectedCount + 1);
  });
}

test("Overview, Screener and Portfolio read the one active dataset", () => {
  const app = source("../src/App.jsx");
  const backtesting = source("../src/BacktestingPage.jsx");
  const screener = source("../src/ScreenerPage.jsx");
  const portfolio = source("../src/PortfolioPage.jsx");
  const overview = source("../src/OverviewPage.jsx");

  assert.match(app, /<UniverseProvider>[\s\S]*<MarketProvider>/);
  assert.match(app, /<RouterProvider>[\s\S]*<UniverseProvider>/);

  for (const page of [screener, portfolio, overview]) {
    assert.match(page, /datasetForUniverse\(data, activeUniverse\)/);
    assert.doesNotMatch(page, /stocks\.slice\(/);
  }
  assert.match(backtesting, /const \{ universe, selectUniverse, activeUniverse, activateUniverse \} = useUniverse\(\)/);
  assert.match(screener, /const \{ activeUniverse, activateUniverse \} = useUniverse\(\)/);
  assert.match(portfolio, /const \{ activeUniverse \} = useUniverse\(\)/);
  assert.match(overview, /const \{ activeUniverse \} = useUniverse\(\)/);

  // A completed run promotes its own universe to the active dataset.
  assert.match(backtesting, /activateUniverse\(normalizedDraft\.portfolio\)/);
  // The Screener switch changes the dataset, so it moves the whole app.
  assert.match(screener, /activateUniverse\(nextMode\)/);
  // A pending universe stays in the draft until the run is submitted.
  assert.match(backtesting, /portfolio: universe,/);
  assert.doesNotMatch(backtesting, /backtest-results-outdated/);
  // Switching universe in the backtest card raises no notification of its own.
  assert.doesNotMatch(backtesting, /backtest-outdated/);
  assert.doesNotMatch(portfolio, /selectUniverse|aria-label="Portfolio selection"/);
});

test("no page falls back to a hardcoded 100-holding assumption", () => {
  const pages = ["../src/OverviewPage.jsx", "../src/PortfolioPage.jsx", "../src/ScreenerPage.jsx", "../src/BacktestingPage.jsx"]
    .map(source)
    .join("\n");
  assert.doesNotMatch(pages, /targetHoldings = 100/);
  assert.doesNotMatch(pages, /\bTop 20%/);
  assert.doesNotMatch(pages, /holdings\.length === 100/);
});

test("the active dataset is persisted so a reload cannot promote a pending selection", () => {
  const provider = source("../src/api/UniverseProvider.jsx");
  assert.match(provider, /useEffect\(\(\) => \{\s*writeActiveUniverse\(activeUniverse\);\s*\}, \[activeUniverse\]\)/);
  assert.match(provider, /const \[activeUniverse, setActiveUniverse\] = useState\(\s*\(\) => readActiveUniverse\(readUniverseSelection\(\)\),?\s*\)/);
  assert.match(provider, /setActiveUniverse\(next\);\s*writeActiveUniverse\(next\);/);
  // Selecting a universe for the next run never touches the active dataset.
  const selectBlock = provider.slice(
    provider.indexOf("const selectUniverse"),
    provider.indexOf("const activateUniverse"),
  );
  assert.doesNotMatch(selectBlock, /setActiveUniverse|writeActiveUniverse/);
});

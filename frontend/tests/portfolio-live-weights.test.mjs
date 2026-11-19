import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LIVE_SECTOR_GROUPS,
  LIVE_WEIGHT_RULE,
  isInvestableSignal,
  liveSectorGroup,
  selectLiveBook,
  simulateLiveWeights,
} from "../src/utils/liveWeights.js";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const portfolioPage = source("../src/PortfolioPage.jsx");
const portfolioPy = source("../../data-service/app/portfolio.py");

/** Rows shaped like liveSignals: rank, ticker, sector, score, floatMarketCap. */
function book(count, { sectorFor = () => "Technology", capFor = (index) => 1e10 * (index + 1), scoreFor = () => 3 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    ticker: `T${String(index + 1).padStart(3, "0")}`,
    sector: sectorFor(index),
    score: scoreFor(index),
    floatMarketCap: capFor(index),
    momentum: 40 - index / 10,
  }));
}

function groupTotals(rows, weights) {
  const totals = new Map();
  for (const row of rows) {
    const weight = weights.get(row.ticker);
    if (weight === undefined) continue;
    const group = liveSectorGroup(row.sector);
    totals.set(group, (totals.get(group) ?? 0) + weight);
  }
  return totals;
}

test("the sector grouping mirrors the server's SECTOR_GROUPS", () => {
  const block = portfolioPy.match(/SECTOR_GROUPS = \{([\s\S]*?)\n\}/);
  assert.ok(block, "portfolio.py must still declare SECTOR_GROUPS");
  const pairs = [...block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)]
    .map(([, key, value]) => [key, value]);
  assert.ok(pairs.length >= 10, "SECTOR_GROUPS should list every sector");
  assert.deepEqual(
    Object.fromEntries(pairs),
    { ...LIVE_SECTOR_GROUPS },
    "frontend sector groups drifted from data-service/app/portfolio.py",
  );
});

test("unknown sectors fall into Others and the mapping is idempotent", () => {
  assert.equal(liveSectorGroup("Semiconductors"), "Others");
  assert.equal(liveSectorGroup(undefined), "Others");
  assert.equal(liveSectorGroup("Consumer"), "Consumer");
  assert.equal(liveSectorGroup(liveSectorGroup("Consumer Staples")), "Consumer");
});

test("simulated weights are fully invested and never exceed the published caps", () => {
  const rows = book(20, {
    sectorFor: (index) => (index < 12 ? "Technology" : index < 16 ? "Healthcare" : "Financials"),
    capFor: (index) => (index < 8 ? 4e11 : 6e9),
    scoreFor: (index) => 4 - index * 0.1,
  });
  const result = simulateLiveWeights(rows);
  assert.ok(result, "a 20-name book across 3 groups must be solvable");

  const total = [...result.weights.values()].reduce((sum, weight) => sum + weight, 0);
  assert.ok(Math.abs(total - 100) < 1e-6, `weights must total 100, got ${total}`);
  assert.equal(result.weights.size, rows.length, "every investable name receives a weight");

  for (const weight of result.weights.values()) {
    assert.ok(weight <= LIVE_WEIGHT_RULE.singleNameCap + 1e-5, `name cap breached at ${weight}`);
  }
  for (const [group, weight] of groupTotals(rows, result.weights)) {
    assert.ok(
      weight <= LIVE_WEIGHT_RULE.sectorCap + 1e-5,
      `sector group ${group} breached its cap at ${weight}`,
    );
  }
  // The cap must actually bind here, otherwise the test proves nothing.
  assert.ok(result.maximumSectorWeight > 34.9, "a Technology-heavy book should sit at the 35% cap");
});

test("the square-root float-cap rule drives the sizing, not equal weight", () => {
  const rows = book(100, {
    sectorFor: (index) => ["Technology", "Healthcare", "Industrials", "Consumer Discretionary"][index % 4],
    capFor: (index) => 1e9 * (index + 1),
    scoreFor: () => 2,
  });
  const result = simulateLiveWeights(rows);
  assert.ok(result);
  // With equal scores, weight follows sqrt(float cap): 100x the cap is 10x the weight.
  const first = result.weights.get("T001");
  const last = result.weights.get("T100");
  assert.ok(last > first * 9.5, `sqrt scaling expected, got ${first} vs ${last}`);
});

test("simulated weights ignore input order and stay deterministic", () => {
  const rows = book(24, {
    sectorFor: (index) => ["Technology", "Healthcare", "Energy"][index % 3],
    capFor: (index) => 5e9 * (index % 7 + 1),
    scoreFor: (index) => 1 + (index % 5) * 0.3,
  });
  const forward = simulateLiveWeights(rows);
  const reversed = simulateLiveWeights([...rows].reverse());
  assert.ok(forward && reversed);
  for (const [ticker, weight] of forward.weights) {
    assert.ok(Math.abs(weight - reversed.weights.get(ticker)) < 1e-9, `${ticker} shifted with order`);
  }
});

test("only scoreable names join the book, and the book stops at the target count", () => {
  const rows = book(30);
  rows[2] = { ...rows[2], floatMarketCap: null };
  rows[5] = { ...rows[5], score: 0 };

  assert.equal(isInvestableSignal(rows[2]), false);
  assert.equal(isInvestableSignal(rows[5]), false);
  assert.equal(isInvestableSignal(rows[0]), true);

  const selected = selectLiveBook(rows, 20);
  assert.equal(selected.length, 20, "skipped names are not replaced by a short book");
  assert.ok(!selected.some((row) => row.ticker === "T003" || row.ticker === "T006"));
  assert.equal(selected.at(-1).ticker, "T022", "the walk must reach past the skipped rows");

  assert.deepEqual(selectLiveBook(rows, 0), []);
  assert.equal(selectLiveBook(rows, 5).length, 5);
});

test("an unsizeable book reports no weight instead of a partial allocation", () => {
  assert.equal(simulateLiveWeights([]), null);
  assert.equal(simulateLiveWeights(null), null);
  // 11 names cannot reach 100% under a 9% single-name cap.
  assert.equal(simulateLiveWeights(book(11)), null);
  // Three groups maximum 35% each cannot reach 100%.
  assert.equal(
    simulateLiveWeights(book(30, { sectorFor: (index) => ["Technology", "Energy"][index % 2] })),
    null,
  );
  // No verified float cap means no size.
  assert.equal(simulateLiveWeights(book(30, { capFor: () => null })), null);
});

test("the page sorts the live table by simulated weight and no longer borrows holdings weights", () => {
  assert.match(portfolioPage, /const \[liveSort, setLiveSort\] = useState\(\{ key: "weight", direction: "desc" \}\)/);
  assert.match(portfolioPage, /selectLiveBook\(liveSignals, targetHoldings\)/);
  assert.match(portfolioPage, /simulateLiveWeights\(liveBook\)/);
  assert.doesNotMatch(portfolioPage, /new Map\(portfolioHoldings\.map/);
  assert.match(portfolioPage, /liveWeighting\?\.weights\.get\(row\.ticker\)/);
  // The published "Target Weight" wording still belongs to the Holdings table.
  assert.match(portfolioPage, /"Weight", "Target Weight"/);
  assert.match(portfolioPage, /"Weight", "Simulated Target Weight/);
});

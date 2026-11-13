import assert from "node:assert/strict";
import test from "node:test";
import { buildPortfolioCsv } from "../src/utils/portfolioExport.js";

test("portfolio CSV keeps strategy rank and writes float-adjusted market cap", () => {
  const holdings = Array.from({ length: 100 }, (_, index) => ({
    rank: index + 1,
    ticker: `T${index + 1}`,
    company: `Company ${index + 1}`,
    sector: index % 2 ? "Technology" : "Consumer",
    score: 1.25,
    market_cap: 10_000_000_000,
    float_market_cap: 5_000_000_000 + index,
    rawWeight: 1,
    finalWeight: 100 - index / 100,
  }));

  const lines = buildPortfolioCsv(holdings).split("\r\n");
  assert.equal(lines.length, 101);
  assert.match(lines[0], /Float-Adjusted Market Cap/);

  const firstHolding = lines[1].split(",");
  const lastHolding = lines.at(-1).split(",");
  assert.equal(firstHolding[0], "1");
  assert.equal(firstHolding[1], "T1");
  assert.equal(firstHolding[2], "Company 1");
  assert.equal(firstHolding[5], "5000000000");
  assert.equal(lastHolding[0], "100");
  assert.equal(lastHolding[1], "T100");
  assert.equal(lastHolding[2], "Company 100");
  assert.equal(lastHolding[5], "5000000099");
});

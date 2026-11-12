import assert from "node:assert/strict";
import test from "node:test";
import { searchMatch } from "../src/utils/stockSearch.js";

const stocks = [
  { ticker: "NVDA", company: "NVIDIA", rank: 22 },
  { ticker: "FRT", company: "Federal Realty Investment Trust", rank: 74 },
  { ticker: "MPC", company: "Marathon Petroleum", rank: 1 },
  { ticker: "MU", company: "Micron Technology", rank: 2 },
  { ticker: "MAC", company: "Macerich", rank: 58 },
  { ticker: "CRWD", company: "CrowdStrike", rank: 32 },
];

test("exact and prefix ticker searches prioritize the ticker", () => {
  assert.equal(searchMatch(stocks[0], "nvda"), 0);
  assert.equal(searchMatch(stocks[0], "nv"), 1);
});

test("short two-letter searches do not match inside Investment", () => {
  assert.equal(searchMatch(stocks[1], "nv"), null);
});

test("company prefix and word-prefix matching remain available", () => {
  assert.equal(searchMatch(stocks[0], "nvidia"), 3);
  assert.equal(searchMatch(stocks[1], "realty"), 4);
  assert.equal(searchMatch(stocks[5], "strike"), 4);
});

test("company substring matching requires at least three characters", () => {
  assert.equal(searchMatch(stocks[4], "cer"), 5);
  assert.equal(searchMatch(stocks[4], "ce"), null);
});

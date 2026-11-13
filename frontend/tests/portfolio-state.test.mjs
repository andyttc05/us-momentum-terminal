import assert from "node:assert/strict";
import test from "node:test";
import { getPortfolioState } from "../src/utils/portfolioState.js";

test("missing portfolio data during startup is loading, never zero holdings", () => {
  const state = getPortfolioState({
    portfolio: null,
    status: "loading",
    meta: { cache_state: "warming" },
    error: null,
  });
  assert.equal(state.kind, "loading");
  assert.match(state.title, /Loading/);
});

test("an unavailable backend portfolio reports its construction reason", () => {
  const state = getPortfolioState({
    portfolio: {
      available: false,
      holdings: [],
      reason: "no verified float-adjusted market caps",
    },
    status: "ready",
    meta: { cache_state: "fresh" },
    error: null,
  });
  assert.equal(state.kind, "unavailable");
  assert.match(state.detail, /float-share fundamentals/i);
});

test("fresh and cached portfolios are distinguished", () => {
  const portfolio = {
    available: true,
    holdings: [{ ticker: "TEST" }],
    fundamentals: { state: "fresh" },
  };
  assert.equal(getPortfolioState({ portfolio, status: "ready", meta: {}, error: null }).kind, "ready");

  portfolio.fundamentals = { state: "cached", fallbackCount: 1 };
  const cached = getPortfolioState({ portfolio, status: "ready", meta: {}, error: null });
  assert.equal(cached.kind, "cached");
  assert.match(cached.detail, /1 holding/);

  const cachedSnapshot = getPortfolioState({
    portfolio: { available: true, holdings: [{ ticker: "TEST" }] },
    status: "ready",
    meta: { cache_state: "cached", refresh_in_progress: true },
    error: null,
  });
  assert.equal(cachedSnapshot.kind, "cached");
  assert.match(cachedSnapshot.title, /cached data/);
});


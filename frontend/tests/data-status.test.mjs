import assert from "node:assert/strict";
import test from "node:test";
import { getDataNoticeState } from "../src/utils/dataStatus.js";

const base = { error: null, status: "ready", meta: {}, refreshing: false, lastRefreshCompletedAt: null };

test("data notices use concise user-facing loading and error text", () => {
  assert.equal(getDataNoticeState({ ...base, status: "loading" }).message, "Updating data…");
  assert.equal(
    getDataNoticeState({ ...base, error: { message: "warming up: first provider fetch in progress" } }).message,
    "Service unavailable",
  );
});

test("partial and cached results remain distinguishable", () => {
  assert.equal(getDataNoticeState({ ...base, meta: { cache_state: "partial" } }).id, "partial");
  assert.equal(getDataNoticeState({ ...base, meta: { cache_state: "cached" } }).id, "cached");
});

test("manual refresh success is brief and stale success is hidden", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(
    getDataNoticeState({ ...base, lastRefreshCompletedAt: new Date(now - 1000), now }).id,
    "updated",
  );
  assert.equal(
    getDataNoticeState({ ...base, lastRefreshCompletedAt: new Date(now - 5000), now }),
    null,
  );
});

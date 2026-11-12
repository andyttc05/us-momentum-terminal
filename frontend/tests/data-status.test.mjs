import assert from "node:assert/strict";
import test from "node:test";
import { getDataNoticeState, isDataUpdating } from "../src/utils/dataStatus.js";

const base = { error: null, status: "ready", meta: {}, refreshing: false, notice: null };

test("updating states never produce a second notification", () => {
  assert.equal(getDataNoticeState({ ...base, status: "loading" }), null);
  assert.equal(getDataNoticeState({ ...base, refreshing: true, notice: { id: "updated" } }), null);
  assert.equal(getDataNoticeState({ ...base, meta: { refresh_in_progress: true } }), null);
  assert.equal(isDataUpdating({ ...base, meta: { cache_state: "warming" } }), true);
});

test("final failure uses the compact required wording", () => {
  assert.equal(
    getDataNoticeState({ ...base, error: { message: "warming up: first provider fetch in progress" } }).message,
    "Update failed",
  );
});

test("completion notices use concise final wording", () => {
  assert.equal(getDataNoticeState({ ...base, notice: { id: "updated" } }).message, "Data updated");
  assert.equal(getDataNoticeState({ ...base, notice: { id: "cached" } }).message, "Using cached data");
  assert.equal(getDataNoticeState({ ...base, notice: { id: "partial" } }).message, "Partial update");
});

test("a final notice is required outside an update cycle", () => {
  assert.equal(getDataNoticeState({ ...base, meta: { cache_state: "cached" } }), null);
  assert.equal(getDataNoticeState({ ...base, notice: { id: "unknown" } }), null);
});

test("completion keys are stable until the provider publishes a new cycle", () => {
  const notice = { id: "updated", key: "updated:one" };
  assert.equal(getDataNoticeState({ ...base, notice }).key, notice.key);
});

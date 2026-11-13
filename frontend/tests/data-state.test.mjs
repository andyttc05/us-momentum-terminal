import assert from "node:assert/strict";
import test from "node:test";
import { getSectionState } from "../src/utils/dataState.js";

test("initial requests use component-level loading states", () => {
  assert.equal(getSectionState({ hasData: false, status: "loading", error: null }), "loading");
  assert.equal(getSectionState({ hasData: false, status: "idle", error: null }), "loading");
});

test("valid data remains ready during refreshes and failed updates", () => {
  assert.equal(getSectionState({
    hasData: true,
    status: "loading",
    refreshing: true,
    error: { message: "timeout" },
  }), "ready");
  assert.equal(getSectionState({
    hasData: true,
    status: "ready",
    error: { message: "offline" },
  }), "ready");
});

test("settled failures and empty responses never remain loading", () => {
  assert.equal(getSectionState({
    hasData: false,
    status: "error",
    error: { message: "timeout" },
  }), "error");
  assert.equal(getSectionState({
    hasData: false,
    status: "ready",
    error: null,
  }), "empty");
});

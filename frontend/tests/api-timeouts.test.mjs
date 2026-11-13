import assert from "node:assert/strict";
import test from "node:test";
import { DATA_REQUEST_TIMEOUT_MS } from "../src/api/timeouts.js";

test("initial data requests wait beyond a Render free-instance cold start", () => {
  assert.ok(DATA_REQUEST_TIMEOUT_MS >= 75_000);
});


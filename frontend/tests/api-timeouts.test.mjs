import assert from "node:assert/strict";
import test from "node:test";
import { DATA_REQUEST_TIMEOUT_MS } from "../src/api/timeouts.js";

test("local data requests allow the Python development service to respond", () => {
  assert.ok(DATA_REQUEST_TIMEOUT_MS >= 15_000);
});

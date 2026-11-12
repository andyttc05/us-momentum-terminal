import assert from "node:assert/strict";
import test from "node:test";
import {
  BLINK_DELAY_MAX_MS,
  BLINK_DELAY_MIN_MS,
  nextBlinkDelay,
  shouldDoubleBlink,
} from "../src/utils/mascotMotion.js";

test("blink delays stay inside the natural range", () => {
  assert.equal(nextBlinkDelay(() => 0), BLINK_DELAY_MIN_MS);
  assert.equal(nextBlinkDelay(() => 1), BLINK_DELAY_MAX_MS);
});

test("double blinks are occasional", () => {
  assert.equal(shouldDoubleBlink(() => 0.1), true);
  assert.equal(shouldDoubleBlink(() => 0.8), false);
});

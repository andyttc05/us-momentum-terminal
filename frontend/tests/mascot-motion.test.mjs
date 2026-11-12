import assert from "node:assert/strict";
import test from "node:test";
import {
  BLINK_DELAY_MAX_MS,
  BLINK_DELAY_MIN_MS,
  nextBlinkDelay,
  pointerEyeOffset,
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

test("eye offsets follow the pointer and clamp at the mascot bounds", () => {
  const rect = { left: 0, top: 0, width: 200, height: 200 };
  const right = pointerEyeOffset(200, 100, rect);
  const top = pointerEyeOffset(100, 0, rect);
  const outside = pointerEyeOffset(999, -999, rect);
  assert.ok(right.x > 0 && Math.abs(right.y) < 0.01);
  assert.ok(top.y < 0 && Math.abs(top.x) < 0.01);
  assert.deepEqual(outside, pointerEyeOffset(200, 0, rect));
});

test("inactive pointer tracking returns to exact neutral", () => {
  assert.deepEqual(
    pointerEyeOffset(200, 0, { left: 0, top: 0, width: 200, height: 200 }, { active: false }),
    { x: 0, y: 0 },
  );
});

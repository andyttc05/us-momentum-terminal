import assert from "node:assert/strict";
import test from "node:test";
import { buildWealthScale, canLogScale, wealthPosition } from "../src/utils/wealthScale.js";

test("a linear axis is zero-anchored and rounds outward to a readable step", () => {
  const scale = buildWealthScale([10_000, 180_000, 313_000]);
  assert.equal(scale.log, false);
  assert.equal(scale.min, 0);
  assert.ok(scale.max >= 313_000);
  assert.deepEqual(scale.ticks.slice(0, 2), [0, 100_000]);
  assert.equal(scale.ticks.at(-1), scale.max);
});

test("a log axis uses log-spaced ticks, not the linear money steps", () => {
  const scale = buildWealthScale([10_000, 45_000, 313_000], { log: true });
  assert.equal(scale.log, true);
  assert.equal(scale.min, 10_000);
  assert.equal(scale.max, 500_000);
  // 1-2-5 ladder: a linear axis would have produced 0, 100K, 200K, 300K, 400K.
  assert.deepEqual(scale.ticks, [10_000, 20_000, 50_000, 100_000, 200_000, 500_000]);
  assert.ok(!scale.ticks.includes(0));
});

test("each log tick is positioned by its own ratio, so decades are evenly spaced", () => {
  const scale = buildWealthScale([10_000, 500_000], { log: true });
  const top = 0;
  const height = 200;
  const at10k = wealthPosition(10_000, scale, top, height);
  const at100k = wealthPosition(100_000, scale, top, height);
  const at500k = wealthPosition(500_000, scale, top, height);
  assert.ok(Math.abs(at500k - top) < 1e-6);
  assert.ok(Math.abs(at10k - (top + height)) < 1e-6);
  // One decade down from the top, one and a half decades for 500k -> 10k.
  assert.ok(Math.abs((at100k - top) - height / Math.log10(50) * Math.log10(5)) < 1e-6);
});

test("positions stay inside the plot for values outside the scale", () => {
  const scale = buildWealthScale([10_000, 100_000], { log: true });
  assert.ok(wealthPosition(1, scale, 10, 100) <= 110);
  assert.ok(wealthPosition(10_000_000, scale, 10, 100) >= 10);
});

test("a zero balance disables the log axis instead of inventing a floor", () => {
  assert.equal(canLogScale([10_000, 0, 5_000]), false);
  const scale = buildWealthScale([10_000, 0, 5_000], { log: true });
  assert.equal(scale.log, false);
  assert.equal(scale.min, 0);
});

test("a flat positive series still produces a usable log axis", () => {
  const scale = buildWealthScale([10_000, 10_000], { log: true });
  assert.equal(scale.log, true);
  assert.ok(scale.max > scale.min);
  assert.ok(Number.isFinite(wealthPosition(10_000, scale, 0, 100)));
});

test("an empty series does not produce NaN ticks", () => {
  const scale = buildWealthScale([], { log: true });
  assert.ok(scale.ticks.every((tick) => Number.isFinite(tick)));
  assert.ok(Number.isFinite(wealthPosition(0, scale, 0, 100)));
});

test("a wide log range thins to decades instead of stacking every ladder step", () => {
  const scale = buildWealthScale([1, 900_000], { log: true });
  assert.ok(scale.ticks.length <= 8);
  assert.equal(scale.ticks[0], 1);
});

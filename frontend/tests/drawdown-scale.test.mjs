import assert from "node:assert/strict";
import test from "node:test";
import { buildDrawdownScale } from "../src/utils/drawdownScale.js";

test("a 40 percent drawdown uses five evenly spaced labels", () => {
  assert.deepEqual(buildDrawdownScale([0, -12, -34.7, -28]).ticks, [0, -10, -20, -30, -40]);
});

test("30 and 50 percent ranges keep ten-point intervals", () => {
  assert.deepEqual(buildDrawdownScale([-23]).ticks, [0, -10, -20, -30]);
  assert.deepEqual(buildDrawdownScale([-47]).ticks, [0, -10, -20, -30, -40, -50]);
});

test("larger ranges choose a readable rounded interval and retain the trough", () => {
  assert.deepEqual(buildDrawdownScale([-124]).ticks, [0, -25, -50, -75, -100, -125]);
});

test("zero drawdown has only the zero line", () => {
  assert.deepEqual(buildDrawdownScale([0, 0]).ticks, [0]);
});

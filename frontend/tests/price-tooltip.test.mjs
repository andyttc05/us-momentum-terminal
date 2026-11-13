import assert from "node:assert/strict";
import test from "node:test";
import {
  PRICE_TOOLTIP_HEIGHT,
  PRICE_TOOLTIP_WIDTH,
  formatTooltipDate,
  nearestObservationIndex,
  placePriceTooltip,
  sideForMovement,
} from "../src/utils/priceTooltip.js";

test("nearestObservationIndex selects actual plotted observations on both sides", () => {
  const points = [{ x: 10 }, { x: 40 }, { x: 70 }];
  assert.equal(nearestObservationIndex(points, 0), 0);
  assert.equal(nearestObservationIndex(points, 29), 1);
  assert.equal(nearestObservationIndex(points, 99), 2);
  assert.equal(nearestObservationIndex([], 10), null);
});

test("tooltip stays opposite to horizontal movement and ignores small jitter", () => {
  let state = sideForMovement({ pointerX: 100, movementOriginX: Number.NaN, currentSide: "left" });
  state = sideForMovement({ ...state, currentSide: state.side, pointerX: 103 });
  assert.equal(state.side, "left");

  state = sideForMovement({ ...state, currentSide: state.side, pointerX: 105 });
  assert.equal(state.side, "left");
  assert.equal(state.movementOriginX, 105);

  state = sideForMovement({ ...state, currentSide: state.side, pointerX: 103 });
  assert.equal(state.side, "left");

  state = sideForMovement({ ...state, currentSide: state.side, pointerX: 99 });
  assert.equal(state.side, "right");
});

test("preferred tooltip side flips at boundaries and remains fully contained", () => {
  const chart = { containerWidth: 520, containerHeight: 300 };
  const left = placePriceTooltip({
    ...chart,
    anchorX: 12,
    anchorY: 30,
    preferredSide: "left",
  });
  assert.equal(left.side, "right");
  assert.ok(left.x >= 8);
  assert.ok(left.x + PRICE_TOOLTIP_WIDTH <= chart.containerWidth - 8);
  assert.ok(left.y >= 8);
  assert.ok(left.y + PRICE_TOOLTIP_HEIGHT <= chart.containerHeight - 8);

  const right = placePriceTooltip({
    ...chart,
    anchorX: chart.containerWidth - 12,
    anchorY: chart.containerHeight - 20,
    preferredSide: "right",
  });
  assert.equal(right.side, "left");
  assert.ok(right.x >= 8);
  assert.ok(right.x + PRICE_TOOLTIP_WIDTH <= chart.containerWidth - 8);
  assert.ok(right.y + PRICE_TOOLTIP_HEIGHT <= chart.containerHeight - 8);
});

test("tooltip date is stable and locale-independent", () => {
  assert.equal(formatTooltipDate("2026-11-10"), "NOV 10, 2026");
  assert.equal(formatTooltipDate("not-a-date"), "—");
});

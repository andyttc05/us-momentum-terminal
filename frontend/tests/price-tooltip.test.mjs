import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_TOOLTIP_GAP,
  CHART_TOOLTIP_MARGIN,
  PRICE_TOOLTIP_HEIGHT,
  PRICE_TOOLTIP_WIDTH,
  fitTooltipWidth,
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
  assert.equal(left.x, 12 + CHART_TOOLTIP_GAP);
  assert.ok(left.x >= CHART_TOOLTIP_MARGIN);
  assert.ok(left.x + PRICE_TOOLTIP_WIDTH <= chart.containerWidth - CHART_TOOLTIP_MARGIN);
  assert.ok(left.y >= CHART_TOOLTIP_MARGIN);
  assert.ok(left.y + PRICE_TOOLTIP_HEIGHT <= chart.containerHeight - CHART_TOOLTIP_MARGIN);

  const right = placePriceTooltip({
    ...chart,
    anchorX: chart.containerWidth - 12,
    anchorY: chart.containerHeight - 20,
    preferredSide: "right",
  });
  assert.equal(right.side, "left");
  assert.equal(right.x + PRICE_TOOLTIP_WIDTH, chart.containerWidth - 12 - CHART_TOOLTIP_GAP);
  assert.ok(right.x >= CHART_TOOLTIP_MARGIN);
  assert.ok(right.x + PRICE_TOOLTIP_WIDTH <= chart.containerWidth - CHART_TOOLTIP_MARGIN);
  assert.ok(right.y >= CHART_TOOLTIP_MARGIN);
  assert.ok(right.y + PRICE_TOOLTIP_HEIGHT <= chart.containerHeight - CHART_TOOLTIP_MARGIN);
});

test("all chart tooltip sizes keep a consistent gap at every horizontal position", () => {
  const tooltipSizes = [
    { width: PRICE_TOOLTIP_WIDTH, height: PRICE_TOOLTIP_HEIGHT },
    { width: 222, height: 128 },
    { width: 196, height: 120 },
    { width: 196, height: 82 },
    { width: 210, height: 102 },
  ];
  const chart = { containerWidth: 520, containerHeight: 300 };
  const anchors = [
    { x: 12, expectedSide: "right" },
    { x: chart.containerWidth / 2, expectedSide: "right" },
    { x: chart.containerWidth - 12, expectedSide: "left" },
  ];

  tooltipSizes.forEach(({ width, height }) => {
    anchors.forEach(({ x, expectedSide }) => {
      const placement = placePriceTooltip({
        ...chart,
        anchorX: x,
        anchorY: chart.containerHeight / 2,
        preferredSide: x === chart.containerWidth / 2
          ? undefined
          : expectedSide === "right" ? "left" : "right",
        tooltipWidth: width,
        tooltipHeight: height,
      });

      assert.equal(placement.side, expectedSide);
      assert.ok(placement.x >= CHART_TOOLTIP_MARGIN);
      assert.ok(placement.x + width <= chart.containerWidth - CHART_TOOLTIP_MARGIN);
      assert.ok(
        placement.side === "left"
          ? placement.x + width <= x - CHART_TOOLTIP_GAP
          : placement.x >= x + CHART_TOOLTIP_GAP,
      );
    });
  });
});

test("top and bottom anchors shift the card inside the chart without resizing it", () => {
  const chart = { containerWidth: 520, containerHeight: 300 };
  const top = placePriceTooltip({
    ...chart,
    anchorX: 260,
    anchorY: 4,
    tooltipWidth: 222,
    tooltipHeight: 128,
  });
  const bottom = placePriceTooltip({
    ...chart,
    anchorX: 260,
    anchorY: 296,
    tooltipWidth: 222,
    tooltipHeight: 128,
  });

  assert.equal(top.y, CHART_TOOLTIP_MARGIN);
  assert.equal(bottom.y + 128, chart.containerHeight - CHART_TOOLTIP_MARGIN);
});

test("reserved chart labels remain outside the tooltip bounds", () => {
  const chart = { containerWidth: 900, containerHeight: 360 };
  const reservedRight = 760;
  [180, 460, 690].forEach((anchorX) => {
    const placement = placePriceTooltip({
      ...chart,
      anchorX,
      anchorY: 160,
      preferredSide: anchorX > 450 ? "right" : "left",
      rightBoundary: reservedRight,
      tooltipWidth: 338,
      tooltipHeight: 148,
    });
    assert.ok(placement.x + 338 <= reservedRight - CHART_TOOLTIP_MARGIN);
  });
});

test("constrained charts narrow the card only enough to preserve the shared gap", () => {
  const chart = { containerWidth: 407, containerHeight: 300 };
  const width = fitTooltipWidth({
    containerWidth: chart.containerWidth,
    preferredWidth: 196,
  });

  assert.equal(width, 167);
  [12, chart.containerWidth / 2, chart.containerWidth - 12].forEach((anchorX) => {
    const placement = placePriceTooltip({
      ...chart,
      anchorX,
      anchorY: chart.containerHeight / 2,
      tooltipWidth: width,
      tooltipHeight: 102,
    });
    assert.ok(placement.x >= CHART_TOOLTIP_MARGIN);
    assert.ok(placement.x + width <= chart.containerWidth - CHART_TOOLTIP_MARGIN);
    assert.ok(
      placement.side === "left"
        ? placement.x + width <= anchorX - CHART_TOOLTIP_GAP
        : placement.x >= anchorX + CHART_TOOLTIP_GAP,
    );
  });
});

test("tooltip date is stable and locale-independent", () => {
  assert.equal(formatTooltipDate("2026-11-10"), "NOV 10, 2026");
  assert.equal(formatTooltipDate("not-a-date"), "—");
});

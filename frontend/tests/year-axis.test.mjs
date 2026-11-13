import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveYearLabelPositions } from "../src/utils/yearAxis.js";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);

test("keeps 2019 visible when the backtest starts near the end of 2018", () => {
  const dates = [
    "2018-12-03",
    "2019-01-02",
    ...Array.from({ length: 19 }, (_, index) => `2019-02-${String(index + 1).padStart(2, "0")}`),
    "2020-01-02",
    ...Array.from({ length: 19 }, (_, index) => `2020-02-${String(index + 1).padStart(2, "0")}`),
    "2021-01-04",
    ...Array.from({ length: 19 }, (_, index) => `2021-02-${String(index + 1).padStart(2, "0")}`),
  ];

  const labels = resolveYearLabelPositions(dates, 54, 1100, 48);

  assert.deepEqual(labels.map(({ year }) => year), ["2018", "2019", "2020", "2021"]);
  assert.ok(labels[1].x - labels[0].x >= 48);
  assert.ok(labels.every(({ x }) => x >= 72 && x <= 1136));
});

test("leaves naturally spaced year labels at their time-axis positions", () => {
  const dates = [
    "2018-01-02",
    "2018-06-01",
    "2019-01-02",
    "2019-06-03",
    "2020-01-02",
    "2020-06-01",
  ];

  const labels = resolveYearLabelPositions(dates, 54, 1100, 48);

  assert.deepEqual(labels.map(({ year }) => year), ["2018", "2019", "2020"]);
  assert.equal(labels[1].x, 54 + 2 / 5 * 1100);
  assert.equal(labels[2].x, 54 + 4 / 5 * 1100);
});

test("returns no year labels for empty or malformed date input", () => {
  assert.deepEqual(resolveYearLabelPositions([], 54, 1100), []);
  assert.deepEqual(resolveYearLabelPositions(null, 54, 1100), []);
  assert.deepEqual(resolveYearLabelPositions(["invalid"], 54, 1100), []);
});

test("the Drawdown chart uses collision-safe labels rather than hiding close year ticks", () => {
  assert.match(page, /resolveYearLabelPositions\(\s*window\.dates,\s*left,\s*plotWidth,\s*compact \? 64 : 48/);
  assert.doesNotMatch(page, /yearLabelPositions\(window\.dates[\s\S]{0,220}?\.filter/);
  assert.match(page, /key=\{year\}\s+x=\{x\}/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveYearLabelPositions } from "../src/utils/yearAxis.js";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);

/**
 * Slice out one top-level function so an assertion can target the chart it
 * names. The cumulative-return chart still uses the legacy collision filter, so
 * a file-wide match would test the wrong component.
 */
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist in BacktestingPage.jsx`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

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

test("no chart calls the removed local year-label helper", () => {
  // The helper used to live in this file. When it moved to yearAxis.js, one
  // call site kept the old name; bundling succeeded and the page threw
  // "yearLabelPositions is not defined" at render. No bare call may remain.
  assert.doesNotMatch(page, /(?<!resolve)yearLabelPositions\(/);
});

test("a backtest starting in December keeps 2019 between 2018 and 2020", () => {
  const labels = resolveYearLabelPositions(
    ["2018-12-03", "2019-01-02", "2020-01-02", "2021-01-04"],
    54,
    1100,
    48,
  );

  assert.deepEqual(labels.map(({ year }) => year), ["2018", "2019", "2020", "2021"]);
  // Only the label glyphs move; the years stay in calendar order.
  assert.ok(labels[1].x > labels[0].x);
  assert.ok(labels[1].x - labels[0].x >= 48);
});

test("the cumulative chart still nudges labels instead of dropping them", () => {
  // The drawdown chart moved to a calendar scale; the cumulative chart keeps
  // this helper, and the earlier 2019 fix has to survive there.
  const cumulative = functionSource(page, "CumulativeChart");

  assert.match(cumulative, /resolveYearLabelPositions\(\s*dates,\s*left,\s*plotWidth,\s*compact \? 66 : 48/);
  // The legacy collision filter dropped the label instead of moving it.
  assert.doesNotMatch(cumulative, /item\.x - list\[index - 1\]\.x >=/);
  assert.doesNotMatch(cumulative, /index === list\.length - 1/);
  assert.doesNotMatch(cumulative, /(?<!resolve)yearLabelPositions\(/);
});

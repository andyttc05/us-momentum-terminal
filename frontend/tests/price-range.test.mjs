import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RANGE,
  formatAxisPrice,
  logPosition,
  priceLogAxis,
  priceRanges,
  rangeChange,
  rangeDays,
  rangeStartIndex,
  timeTicks,
} from "../src/utils/priceRange.js";

/** Weekly Fridays ending 2026-11-13, twelve years back. */
function weeklyDates(count) {
  const end = Date.UTC(2026, 10, 13);
  return Array.from({ length: count }, (_, index) => (
    new Date(end - (count - 1 - index) * 7 * 86_400_000).toISOString().slice(0, 10)
  ));
}

const DATES = weeklyDates(626); // ~12 years of Fridays

test("the five ranges are offered and 1Y is the default", () => {
  assert.deepEqual(priceRanges, ["1Y", "3Y", "5Y", "10Y", "ALL"]);
  assert.equal(DEFAULT_RANGE, "1Y");
  assert.equal(rangeDays.ALL, null);
  for (const range of priceRanges.filter((item) => item !== "ALL")) {
    assert.ok(rangeDays[range] > 0, range);
  }
  // The sub-year windows are gone, not merely hidden.
  for (const gone of ["1M", "3M", "6M"]) {
    assert.equal(rangeDays[gone], undefined);
  }
});

test("each range starts at the first observation inside its calendar window", () => {
  const oneYear = rangeStartIndex(DATES, "1Y");
  const threeYears = rangeStartIndex(DATES, "3Y");
  const tenYears = rangeStartIndex(DATES, "10Y");
  // 52 weeks per year, so 1Y lands on the 53rd-from-last observation.
  assert.equal(DATES.length - oneYear, 53);
  assert.ok(DATES.length - threeYears > 155 && DATES.length - threeYears < 160);
  assert.ok(DATES.length - tenYears > 520 && DATES.length - tenYears < 526);
  assert.ok(threeYears < oneYear);
  assert.ok(tenYears < threeYears);
  // ALL keeps every observation.
  assert.equal(rangeStartIndex(DATES, "ALL"), 0);
});

test("a window the series cannot reach falls back to the first real observation", () => {
  const short = DATES.slice(-60); // barely a year
  assert.equal(rangeStartIndex(short, "10Y"), 0);
  assert.equal(rangeStartIndex(short, "5Y"), 0);
  assert.ok(rangeStartIndex(short.slice(-20), "1Y") >= 0);
  // Nothing is invented: the caller simply draws from index 0.
  assert.equal(rangeStartIndex([], "1Y"), 0);
});

test("the range change is the move across the visible window", () => {
  assert.ok(Math.abs(rangeChange([100, 120, 131]) - 31) < 1e-9);
  assert.ok(Math.abs(rangeChange([100, 50]) + 50) < 1e-9);
  assert.equal(rangeChange([80, 80, 80]), 0);
  // Not enough observations, an unusable first price, or junk input yield null
  // rather than a fabricated number.
  assert.equal(rangeChange([100]), null);
  assert.equal(rangeChange([]), null);
  assert.equal(rangeChange([0, 50]), null);
  assert.equal(rangeChange([Number.NaN, 50]), null);
  // Non-finite points are skipped, so a single bad bar cannot break the span.
  assert.ok(Math.abs(rangeChange([100, Number.NaN, 131]) - 31) < 1e-9);
});

test("axis labels follow the window: months, quarters, then years", () => {
  const year = DATES.slice(rangeStartIndex(DATES, "1Y"));
  const monthTicks = timeTicks(year, "1Y");
  assert.ok(monthTicks.length >= 11 && monthTicks.length <= 13, String(monthTicks.length));
  // January is labelled with the year, which is what anchors a 12-month axis.
  assert.ok(monthTicks.every((tick) => /^(\d{4}|[A-Z][a-z]{2})$/.test(tick.label)));

  const decade = DATES.slice(rangeStartIndex(DATES, "10Y"));
  const yearTicks = timeTicks(decade, "10Y");
  assert.ok(yearTicks.length >= 9 && yearTicks.length <= 12, String(yearTicks.length));
  assert.ok(yearTicks.every((tick) => /^\d{4}$/.test(tick.label)));

  const threeYears = DATES.slice(rangeStartIndex(DATES, "3Y"));
  const quarterTicks = timeTicks(threeYears, "3Y");
  // One label per quarter, and January carries the year so quarters stay
  // attributable without counting backwards.
  assert.ok(quarterTicks.length >= 11 && quarterTicks.length <= 14, String(quarterTicks.length));
  const fiveYears = DATES.slice(rangeStartIndex(DATES, "5Y"));
  const halfYearTicks = timeTicks(fiveYears, "5Y");
  assert.ok(halfYearTicks.length >= 9 && halfYearTicks.length <= 12, String(halfYearTicks.length));
  assert.ok(quarterTicks.some((tick) => /^\d{4}$/.test(tick.label)));
  for (const tick of quarterTicks) {
    assert.ok(tick.index >= 0 && tick.index < threeYears.length);
    // A month name repeats once per year, which is what the year label is for.
    assert.match(tick.label, /^(\d{4}|[A-Z][a-z]{2})$/, tick.label);
  }
});

test("the log axis drops zero, negative and invalid prices", () => {
  const axis = priceLogAxis([48, 0, -3, null, undefined, Number.NaN, 80, 62]);
  assert.ok(axis.min > 0);
  assert.ok(axis.max >= 80);
  assert.ok(axis.ticks.every((tick) => tick > 0));
  assert.ok(axis.ticks.every((tick) => tick >= axis.min && tick <= axis.max));
  assert.equal(priceLogAxis([0, -1, Number.NaN]), null);
});

test("log positions spread a decade evenly and stay inside the plot", () => {
  const axis = priceLogAxis([10, 100]);
  assert.equal(axis.min, 10);
  assert.equal(axis.max, 100);
  const top = 0;
  const height = 200;
  assert.ok(Math.abs(logPosition(100, axis, top, height) - top) < 1e-6);
  assert.ok(Math.abs(logPosition(10, axis, top, height) - (top + height)) < 1e-6);
  assert.ok(Math.abs(logPosition(10 ** 1.5, axis, top, height) - (top + height / 2)) < 1e-6);
  // Values outside the domain clamp instead of drawing outside the frame.
  assert.ok(logPosition(1, axis, top, height) <= top + height + 1e-6);
  assert.ok(logPosition(1000, axis, top, height) >= top - 1e-6);
});

test("log ticks stay readable across one and two decades", () => {
  const narrow = priceLogAxis([48, 80]); // a single quiet year
  assert.ok(narrow.ticks.length >= 3, String(narrow.ticks.length));
  const wide = priceLogAxis([20, 260]); // ten years
  assert.ok(wide.ticks.length <= 9);
  assert.ok(wide.ticks[0] >= wide.min);
});

test("axis prices keep cents only while they matter", () => {
  assert.equal(formatAxisPrice(356), "$356");
  assert.equal(formatAxisPrice(48.2), "$48.2");
  assert.equal(formatAxisPrice(5.4321), "$5.43");
  assert.equal(formatAxisPrice(null), "—");
});

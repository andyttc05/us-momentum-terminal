import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_AXIS_INSET,
  calendarYearSpan,
  createCalendarScale,
  daysInYear,
  labelStride,
  parseIsoDate,
  visibleYearTicks,
  yearLabelGap,
} from "../src/utils/calendarAxis.js";
import { nearestObservationIndex } from "../src/utils/priceTooltip.js";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);

const DAY = 86_400_000;
const iso = (time) => new Date(time).toISOString().slice(0, 10);

/** Every weekday from `start` to `end` inclusive, like the real backtest series. */
function weekdaySeries(start, end) {
  const dates = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += DAY) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(iso(time));
  }
  return dates;
}

function yearFraction(date) {
  const { year, month, day } = parseIsoDate(date);
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return (Date.UTC(year, month - 1, day) - start) / (end - start);
}

// The live backtest runs from 2 April 2018 to the latest published session.
const DATES = weekdaySeries("2018-04-02", "2026-11-13");
const LEFT = 54;
const PLOT_WIDTH = 1100;

test("the axis spans the calendar years of the observations, not their count", () => {
  const axis = createCalendarScale(DATES, LEFT, PLOT_WIDTH);

  assert.equal(axis.firstYear, 2018);
  assert.equal(axis.lastYear, 2026);
  assert.equal(axis.yearCount, 9);
  assert.deepEqual(axis.ticks.map(({ year }) => year), [
    "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026",
  ]);

  // Equal segment widths are the whole point: nine years, nine equal slices.
  assert.equal(axis.segmentWidth, (PLOT_WIDTH - CALENDAR_AXIS_INSET * 2) / 9);
  assert.equal(axis.ticks[0].x, LEFT + CALENDAR_AXIS_INSET);
  assert.ok(axis.ticks.at(-1).x < axis.innerRight);
});

test("consecutive annual ticks are exactly evenly spaced", () => {
  const { ticks, segmentWidth } = createCalendarScale(DATES, LEFT, PLOT_WIDTH);
  const gaps = ticks.slice(1).map((tick, index) => tick.x - ticks[index].x);

  for (const gap of gaps) {
    assert.ok(Math.abs(gap - segmentWidth) < 1e-9, `gap ${gap} vs segment ${segmentWidth}`);
  }
});

test("2 April 2018 sits a quarter of the way into the 2018 segment", () => {
  const axis = createCalendarScale(DATES, LEFT, PLOT_WIDTH);
  const x = axis.xForDate("2018-04-02");
  const expected = axis.innerLeft + yearFraction("2018-04-02") * axis.segmentWidth;

  assert.ok(Math.abs(x - expected) < 1e-9);
  // After the 1 January boundary, not stretched back onto it.
  assert.ok(x > axis.ticks[0].x);
  const share = (x - axis.ticks[0].x) / axis.segmentWidth;
  assert.ok(share > 0.24 && share < 0.26, `share ${share}`);
  // And nowhere near a full segment in, which is what index spacing did.
  assert.ok(x < axis.ticks[1].x);
});

test("January observations sit at the start of their own segment", () => {
  const axis = createCalendarScale(DATES, LEFT, PLOT_WIDTH);

  for (const [date, tickIndex] of [["2019-01-02", 1], ["2020-01-02", 2], ["2021-01-04", 3]]) {
    const x = axis.xForDate(date);
    const tick = axis.ticks[tickIndex];
    assert.ok(x > tick.x, `${date} must follow the ${tick.year} boundary`);
    assert.ok(x - tick.x < axis.segmentWidth * 0.02, `${date} must hug its boundary`);
  }

  // 2020 is a leap year, so 2 January is a 366th of the way in, not a 365th.
  const leapShare = (axis.xForDate("2020-01-02") - axis.ticks[2].x) / axis.segmentWidth;
  assert.ok(Math.abs(leapShare - 1 / daysInYear(2020)) < 1e-9);
});

test("plotted x coordinates increase with the observation date", () => {
  const axis = createCalendarScale(DATES, LEFT, PLOT_WIDTH);
  let previous = -Infinity;

  for (const date of DATES) {
    const x = axis.xForDate(date);
    assert.ok(Number.isFinite(x), `${date} must plot`);
    assert.ok(x > previous, `${date} must plot to the right of the previous session`);
    previous = x;
  }

  assert.ok(previous <= LEFT + PLOT_WIDTH);
});

test("chart points stay inside the plot and keep one x per observation", () => {
  const axis = createCalendarScale(DATES, LEFT, PLOT_WIDTH);
  const points = DATES.map((date) => ({ x: axis.xForDate(date) }));

  assert.equal(points.length, DATES.length);
  for (const point of points) {
    assert.ok(point.x >= LEFT && point.x <= LEFT + PLOT_WIDTH);
  }
});

test("the tooltip still selects the observation under the pointer", () => {
  const axis = createCalendarScale(DATES, LEFT, PLOT_WIDTH);
  const points = DATES.map((date) => ({ x: axis.xForDate(date) }));

  for (const date of ["2018-04-02", "2021-06-15", "2026-11-13"]) {
    const index = DATES.indexOf(date);
    assert.notEqual(index, -1, `${date} should be in the series`);
    assert.equal(nearestObservationIndex(points, axis.xForDate(date)), index);

    // A pointer inside the same day still resolves to it. Nine years share
    // ~1100px, so one session is a fraction of a pixel wide.
    const quarterDay = axis.segmentWidth / daysInYear(2021) / 4;
    assert.equal(nearestObservationIndex(points, points[index].x + quarterDay), index);
  }
});

test("mobile thins to every other year, keeping 2018 and the even grid", () => {
  // 390px viewport: the drawdown frame is 328px wide, plot 42 + 268 with an
  // 18px inset each side. Nine labels would sit 2.6px apart, which reads as one
  // run of digits, so the density strategy drops to every second year.
  const chartWidth = 328;
  const left = 42;
  const plotWidth = chartWidth - left - 18;
  const axis = createCalendarScale(DATES, left, plotWidth);
  const gap = yearLabelGap(true);
  const ticks = visibleYearTicks(axis.ticks, axis.segmentWidth, gap);
  const halfLabel = 11.5;

  assert.deepEqual(ticks.map(({ year }) => year), ["2018", "2020", "2022", "2024", "2026"]);

  for (const tick of ticks) {
    assert.ok(tick.x - halfLabel >= left, `${tick.year} would clip on the left`);
    assert.ok(tick.x + halfLabel <= left + plotWidth, `${tick.year} would clip on the right`);
  }

  for (let index = 1; index < ticks.length; index += 1) {
    const spacing = ticks[index].x - ticks[index - 1].x;
    assert.ok(spacing >= gap, `${ticks[index].year} is too close to ${ticks[index - 1].year}`);
    // Skipping years must never move one off the calendar grid.
    const steps = Math.round(spacing / axis.segmentWidth);
    assert.ok(Math.abs(spacing - steps * axis.segmentWidth) < 1e-9);
  }
});

test("a slightly wider phone still shows every year", () => {
  // 430px viewport: plot 42 + 338, so each year gets 33.6px and nine labels fit.
  const axis = createCalendarScale(DATES, 42, 338);
  const ticks = visibleYearTicks(axis.ticks, axis.segmentWidth, yearLabelGap(true));

  assert.equal(ticks.length, 9);
  assert.deepEqual(ticks.map(({ year }) => year), [
    "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026",
  ]);
});

test("a very narrow axis thins labels instead of crowding them", () => {
  const long = weekdaySeries("2018-04-02", "2047-12-31");
  const axis = createCalendarScale(long, 42, 200);
  const stride = labelStride(axis.segmentWidth, yearLabelGap(true));
  const ticks = visibleYearTicks(axis.ticks, axis.segmentWidth, yearLabelGap(true));

  assert.ok(stride > 1, "thirty years in 200px cannot hold every label");
  assert.equal(ticks.length, Math.ceil(axis.ticks.length / stride));
  assert.equal(ticks[0].year, "2018");
  for (let index = 1; index < ticks.length; index += 1) {
    const spacing = ticks[index].x - ticks[index - 1].x;
    assert.ok(spacing >= yearLabelGap(true) - 1e-9);
  }
});

test("the drawdown chart plots dates, not indexes", () => {
  const drawdown = page.slice(page.indexOf("function DrawdownChart"), page.indexOf("function AnnualReturnTable"));

  assert.match(drawdown, /createCalendarScale\(window\.dates, left, plotWidth\)/);
  assert.match(drawdown, /xForDate\(window\.dates\[index\]\)/);
  // The filled area must follow the same coordinates as the line.
  assert.match(drawdown, /points\.at\(-1\)\.x\} \$\{top\} L \$\{points\[0\]\.x\}/);
  assert.match(drawdown, /visibleYearTicks\(axis\.ticks, axis\.segmentWidth, yearLabelGap\(compact\)\)/);
  // Index spacing and the old nudge-to-fit labels are gone from this chart.
  assert.doesNotMatch(drawdown, /index \/ Math\.max\(1, values\.length - 1\) \* plotWidth/);
  assert.doesNotMatch(drawdown, /resolveYearLabelPositions/);
});

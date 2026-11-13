import assert from "node:assert/strict";
import test from "node:test";
import { createDateScale, dayNumber, placeTicks } from "../src/utils/timeAxis.js";

const LEFT = 52;
const WIDTH = 700;
const CANVAS = LEFT + WIDTH + 92;

/** Last day of every month between two ISO dates, inclusive. */
function monthEnds(from, to) {
  const [startYear, startMonth] = from.split("-").map(Number);
  const out = [];
  let year = startYear;
  let month = startMonth;
  for (let guard = 0; guard < 400; guard += 1) {
    const iso = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (iso > to) break;
    if (iso >= from) out.push(iso);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

test("day stamps parse as whole days regardless of timezone", () => {
  assert.equal(dayNumber("2025-11-13"), dayNumber("2025-11-13"));
  assert.equal(daysBetween("2025-11-30", "2025-12-31"), 31);
  assert.equal(daysBetween("2026-02-28", "2026-03-31"), 31);
  assert.equal(dayNumber("not-a-date"), null);
  assert.equal(dayNumber(undefined), null);
});

test("the first sample and every later sample share one date mapping", () => {
  const scale = createDateScale(["2025-11-13", "2025-11-30", "2025-12-31", "2026-01-31"]);
  assert.equal(scale("2025-11-13"), 0);
  assert.equal(scale("2026-01-31"), 1);
  // 17 of the 79 elapsed days, not 1 of 3 slots.
  assert.ok(Math.abs(scale("2025-11-30") - 17 / 79) < 1e-12);
});

test("a mid-month 1Y window spaces months by elapsed days, not by index", () => {
  // The reported case: the window opens mid-November, so the first plotted
  // sample is 13 Nov but the first calendar month end is 30 Nov.
  const samples = ["2025-11-13", ...monthEnds("2025-11-13", "2026-11-12")];
  const scale = createDateScale([...samples.slice(0, -1), "2026-11-12"]);
  const specs = monthEnds("2025-11-13", "2026-11-12").map((date) => ({
    date,
    label: new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
  }));

  const placed = placeTicks(specs, {
    xFor: (spec) => LEFT + scale(spec.date) * WIDTH,
    width: CANVAS,
    charWidth: 6.7,
    gap: 10,
  });

  assert.equal(placed.length, specs.length, "all twelve months fit at this width");
  // The first label sits where 30 Nov belongs, not pinned to the plot edge.
  assert.ok(placed[0].x > LEFT + 20, "first label is not glued to the left edge");

  const dayGaps = placed.slice(1).map((tick, index) => daysBetween(placed[index].date, tick.date));
  for (const gap of dayGaps) {
    assert.ok(gap >= 28 && gap <= 31, `month gap of ${gap} days is not a calendar month`);
  }
  // November-December is 31 days like December-January, so the drawn intervals
  // may differ only by real month length - never by a doubled slot.
  const ratios = dayGaps.map((gap) => gap / 30.4);
  assert.ok(Math.max(...ratios) / Math.min(...ratios) < 1.15, "interval spread is month length only");
});

test("older index-positioned labels keep index placement", () => {
  const labels = ["Nov", "", "Dec", "Jan"];
  const specs = labels.map((label, index) => ({ label, index }));
  const placed = placeTicks(specs, {
    xFor: (spec) => LEFT + (spec.index / (labels.length - 1)) * WIDTH,
    width: CANVAS,
    charWidth: 6.7,
  });
  assert.deepEqual(placed.map((tick) => tick.label), ["Nov", "Dec", "Jan"]);
  // Legacy path keeps its own spacing; it is only a fallback for stale caches.
  assert.ok(Math.abs(placed[1].x - (LEFT + (2 / 3) * WIDTH)) < 1e-9);
});

test("crowded labels are thinned on a constant stride and never nudged", () => {
  const specs = monthEnds("2018-01-31", "2019-01-31").map((date) => ({ date, label: "Nov '25" }));
  const scale = createDateScale([specs[0].date, specs.at(-1).date]);
  const placed = placeTicks(specs, {
    xFor: (spec) => LEFT + scale(spec.date) * WIDTH,
    width: CANVAS,
    charWidth: 6.7,
    gap: 10,
  });

  assert.ok(placed.length < specs.length, "some labels must be dropped at this density");
  for (const tick of placed) {
    assert.ok(Math.abs(tick.x - (LEFT + scale(tick.date) * WIDTH)) < 1e-9, "kept labels stay on their date");
  }
  // A constant number of months between labels: no adjacent pair next to a
  // double-width gap.
  const positions = placed.map((tick) => specs.findIndex((spec) => spec.date === tick.date));
  const strides = positions.slice(1).map((position, index) => position - positions[index]);
  assert.equal(new Set(strides).size, 1, `ragged strides: ${strides.join(",")}`);
});

test("cramped axes thin the 1Y months evenly instead of unevenly", () => {
  const specs = monthEnds("2025-11-12", "2026-11-12").map((date) => ({
    date,
    label: new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
  }));
  const scale = createDateScale(["2025-11-12", "2026-11-12"]);
  const placed = placeTicks(specs, {
    xFor: (spec) => LEFT + scale(spec.date) * 270,
    width: 340,
    charWidth: 5.6,
    gap: 6,
  });
  assert.ok(placed.length >= 4, "a phone keeps a usable number of months");
  const positions = placed.map((tick) => specs.findIndex((spec) => spec.date === tick.date));
  const strides = positions.slice(1).map((position, index) => position - positions[index]);
  assert.equal(new Set(strides).size, 1, `ragged strides: ${strides.join(",")}`);
  assert.ok(strides[0] >= 2, "a cramped axis labels every other month or less");
});

test("labels that would spill outside the canvas are dropped", () => {
  const specs = [
    { date: "2026-01-05", label: "Jan" },
    { date: "2026-01-31", label: "Feb" },
  ];
  const placed = placeTicks(specs, { xFor: (spec) => (spec.label === "Jan" ? 4 : 300), width: 400, charWidth: 7 });
  assert.deepEqual(placed.map((tick) => tick.label), ["Feb"]);
});

test("unusable stamps fall back rather than invent a scale", () => {
  assert.equal(createDateScale([]), null);
  assert.equal(createDateScale(["2026-01-31"]), null);
  assert.equal(createDateScale(["2026-01-31", "31/01/2026"]), null);
  assert.equal(createDateScale(["2026-02-01", "2026-02-01"]), null);
});

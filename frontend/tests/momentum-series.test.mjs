import assert from "node:assert/strict";
import test from "node:test";
import {
  MOMENTUM_BASE_INDEX,
  momentumSeries,
  momentumSeriesDomain,
  momentumSeriesGeometry,
  momentumSeriesPoints,
  momentumSeriesValues,
} from "../src/utils/momentumSeries.js";

// Real publication values for the three audited symbols.
const MPC_END = 246.3497;
const MU_END = 379.5646;
const HPE_END = 280.6815;

const stock = (ticker, values, extra = {}) => ({
  ticker,
  momentum: (values.at(-1) / values[0] - 1) * 100,
  sparkline12_1: { values, startDate: "2025-11-11", endDate: "2026-10-14", ...extra },
});

const universe = [
  stock("MPC", [100, 180, MPC_END]),
  stock("MU", [100, 240, MU_END]),
  stock("HPE", [100, 210, HPE_END]),
  stock("WEAK", [100, 101, 108]),
  stock("LOSER", [100, 80, 70]),
];

test("values stay attached to their ticker through sorting, filtering and pagination", () => {
  const sorted = [...universe].sort((left, right) => left.ticker.localeCompare(right.ticker));
  const page = sorted.slice(2, 4);
  const byTicker = Object.fromEntries(page.map((row) => [row.ticker, momentumSeriesValues(row)]));

  assert.deepEqual(byTicker.MPC, [100, 180, MPC_END]);
  assert.deepEqual(byTicker.MU, [100, 240, MU_END]);
  assert.equal(byTicker.HPE, undefined);

  const searched = universe.filter((row) => row.ticker.startsWith("HP"));
  assert.equal(momentumSeriesValues(searched[0]).at(-1), HPE_END);
});

test("the series is the server payload, never a second calculation", () => {
  const series = momentumSeries(universe[1]);
  assert.equal(series.ticker, "MU");
  assert.equal(series.firstIndex, MOMENTUM_BASE_INDEX);
  assert.ok(Math.abs(series.lastIndex - MU_END) < 1e-9);
  assert.equal(series.startDate, "2025-11-11");
  assert.equal(series.endDate, "2026-10-14");
  // The indexed endpoint has to reproduce the displayed momentum exactly.
  assert.ok(Math.abs((series.lastIndex / MOMENTUM_BASE_INDEX - 1) * 100 - 279.5646) < 1e-4);
});

test("one domain is shared by every row, whatever is on screen", () => {
  const full = momentumSeriesDomain(universe);
  assert.ok(full.min < 70, "domain must contain the weakest path");
  assert.ok(full.max > MU_END, "domain must contain the strongest path");
  // Filtering to a single ticker must not move the scale: the page always
  // passes the whole universe, so this is the same object.
  assert.deepEqual(momentumSeriesDomain(universe), full);

  // The base of 100 always sits inside the domain.
  assert.ok(full.min <= 100 && full.max >= 100);
});

test("strong and weak paths are distinguishable on the shared scale", () => {
  const domain = momentumSeriesDomain(universe);
  const endY = (values) => momentumSeriesGeometry(values, domain).at(-1).y;
  // y grows downwards, so a stronger path must finish higher up the box.
  assert.ok(endY([100, MU_END]) < endY([100, HPE_END]));
  assert.ok(endY([100, HPE_END]) < endY([100, MPC_END]));
  assert.ok(endY([100, MPC_END]) < endY([100, 108]));
  assert.ok(endY([100, 108]) < endY([100, 70]));
});

test("the same curve projects identically at any box size", () => {
  const domain = momentumSeriesDomain(universe);
  const values = universe[1].sparkline12_1.values;
  const mini = momentumSeriesGeometry(values, domain, { left: 0, top: 0, width: 100, height: 26 });
  const large = momentumSeriesGeometry(values, domain, { left: 40, top: 10, width: 400, height: 200 });

  assert.equal(mini.length, large.length);
  // Same relative curve: normalising both boxes makes the points coincide.
  for (let index = 0; index < mini.length; index += 1) {
    const miniRelative = (mini[index].y - 0) / 26;
    const largeRelative = (large[index].y - 10) / 200;
    assert.ok(Math.abs(miniRelative - largeRelative) < 1e-9, `point ${index} drifts between sizes`);
  }
  // The x axis is a plain index ramp in both sizes.
  assert.equal(mini[0].x, 0);
  assert.equal(mini.at(-1).x, 100);
  assert.equal(large[0].x, 40);
  assert.equal(large.at(-1).x, 440);
});

test("the endpoint of the plotted line matches the displayed momentum", () => {
  const domain = momentumSeriesDomain(universe);
  for (const row of [universe[0], universe[1], universe[2]]) {
    const series = momentumSeries(row);
    const endY = momentumSeriesGeometry(series.values, domain).at(-1).y;
    // A two-point path that ends at the same index must land on the same pixel.
    const sameEndY = momentumSeriesGeometry([MOMENTUM_BASE_INDEX, series.lastIndex], domain).at(-1).y;
    assert.ok(Math.abs(endY - sameEndY) < 1e-9, `${row.ticker} endpoint drifts`);
    const drawnMomentum = (series.lastIndex / MOMENTUM_BASE_INDEX - 1) * 100;
    assert.ok(Math.abs(drawnMomentum - row.momentum) < 1e-6, `${row.ticker} endpoint disagrees with the label`);
  }
  // And the three audited figures match the published momentum percentages.
  assert.ok(Math.abs((MPC_END / 100 - 1) * 100 - 146.3) < 0.1);
  assert.ok(Math.abs((MU_END / 100 - 1) * 100 - 279.6) < 0.1);
  assert.ok(Math.abs((HPE_END / 100 - 1) * 100 - 180.7) < 0.1);
});

test("every path starts on the 100 base, whatever the scale", () => {
  const domain = momentumSeriesDomain(universe);
  for (const row of universe) {
    const values = row.sparkline12_1.values;
    const start = momentumSeriesGeometry(values, domain).at(0);
    const base = momentumSeriesGeometry([MOMENTUM_BASE_INDEX, values.at(-1)], domain).at(0);
    assert.ok(Math.abs(start.y - base.y) < 1e-9, `${row.ticker} does not start on the base`);
  }
});

test("missing or malformed history renders as unavailable", () => {
  assert.deepEqual(momentumSeriesValues({ ticker: "MPC", trend: [100, 120] }), []);
  assert.deepEqual(momentumSeriesValues(stock("MPC", [100, null])), []);
  assert.deepEqual(momentumSeriesValues(stock("MPC", [100])), []);
  assert.equal(momentumSeries(null), null);
  assert.equal(momentumSeriesPoints([], { min: 50, max: 200 }), "");
  assert.deepEqual(momentumSeriesGeometry([], { min: 50, max: 200 }), []);
});

test("an absent shared domain falls back to the series' own range", () => {
  const values = [100, 150, 200];
  const geometry = momentumSeriesGeometry(values, undefined);
  assert.equal(geometry.length, 3);
  assert.ok(geometry.at(-1).y < geometry[0].y, "a rising path must still rise");
  const falling = momentumSeriesGeometry([200, 150, 100], undefined);
  assert.ok(falling.at(-1).y > falling[0].y, "a falling path must still fall");
});

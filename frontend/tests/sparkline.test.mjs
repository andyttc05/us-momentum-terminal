import assert from "node:assert/strict";
import test from "node:test";
import {
  momentumSparklineDomain,
  momentumSparklinePoints,
  momentumSparklineValues,
} from "../src/utils/sparkline.js";

const stock = (ticker, values) => ({ ticker, sparkline12_1: { values } });

test("sparkline values stay attached to their ticker through sorting and pagination", () => {
  const stocks = [
    stock("MPC", [100, 150, 246.3]),
    stock("MU", [100, 170, 379.6]),
    stock("HPE", [100, 130, 280.7]),
  ];
  const paginated = [...stocks].sort((left, right) => right.ticker.localeCompare(left.ticker)).slice(0, 2);
  const byTicker = Object.fromEntries(paginated.map((row) => [row.ticker, momentumSparklineValues(row)]));
  assert.deepEqual(byTicker.MU, [100, 170, 379.6]);
  assert.deepEqual(byTicker.MPC, [100, 150, 246.3]);
  assert.equal(byTicker.HPE, undefined);
});

test("sparkline domain is shared across all displayed stocks", () => {
  const domain = momentumSparklineDomain([
    stock("MPC", [100, 246.3]),
    stock("MU", [100, 379.6]),
    stock("LOSER", [100, 70]),
  ]);
  assert.ok(domain.min <= 70);
  assert.ok(domain.max >= 379.6);
  const mpcPoints = momentumSparklinePoints([100, 246.3], domain);
  const muPoints = momentumSparklinePoints([100, 379.6], domain);
  const mpcEndY = Number(mpcPoints.split(" ").at(-1).split(",")[1]);
  const muEndY = Number(muPoints.split(" ").at(-1).split(",")[1]);
  assert.ok(muEndY < mpcEndY);
});

test("missing or malformed historical data is unavailable", () => {
  assert.deepEqual(momentumSparklineValues({ ticker: "MPC", trend: [100, 120] }), []);
  assert.deepEqual(momentumSparklineValues(stock("MPC", [100, null])), []);
  assert.deepEqual(momentumSparklineValues(stock("MPC", [100])), []);
  assert.equal(momentumSparklinePoints([], { min: 0, max: 100 }), "");
});

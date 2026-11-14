import assert from "node:assert/strict";
import test from "node:test";
import { computeWindowMetrics, formatBacktestDuration } from "../src/utils/backtestMetrics.js";

const PUBLISHED = { cumulative_return: 366.9, cagr: 19.6, max_drawdown: -34.7, sharpe: 1.05 };

const navWindow = (values, { startsAtOrigin = false, fullWindow = false, dates = null } = {}) => ({
  strategy: values,
  dates: dates ?? values.map((_, index) => new Date(Date.UTC(2020, 0, 2 + index)).toISOString().slice(0, 10)),
  drawdown: values.map((value, index) => {
    const peak = Math.max(...values.slice(0, index + 1));
    return Number(((value / peak - 1) * 100).toFixed(2));
  }),
  startsAtBacktestOrigin: startsAtOrigin,
  fullWindow,
});

test("the full published window shows the backend's own metrics", () => {
  // The chart's first NAV is 99.9 because the entry cost is already paid.
  const window = navWindow([99.9, 150, 466.87], { startsAtOrigin: true, fullWindow: true });
  const metrics = computeWindowMetrics(window, PUBLISHED);

  assert.equal(metrics.source, "backend");
  assert.equal(metrics.totalReturn, 366.9);
  assert.equal(metrics.cagr, 19.6);
  assert.equal(metrics.maxDrawdown, -34.7);
  assert.equal(metrics.sharpe, 1.05);
});

test("a window starting at the origin is measured from the starting capital", () => {
  // Truncated end date: still starts at the origin, so 100 is the base, not 99.9.
  const window = navWindow([99.9, 150, 200], { startsAtOrigin: true, fullWindow: false });
  const metrics = computeWindowMetrics(window, PUBLISHED);

  assert.equal(metrics.source, "window");
  assert.equal(metrics.totalReturn, 100);
  // Rebasing on the costed 99.9 NAV would report +100.2% instead.
  assert.ok(Math.abs(metrics.totalReturn - 100.2) > 0.1);
});

test("a narrowed window is measured from its own first observation", () => {
  const window = navWindow([250, 300, 350]);
  const metrics = computeWindowMetrics(window, PUBLISHED);
  assert.equal(metrics.source, "window");
  assert.ok(Math.abs(metrics.totalReturn - 40) < 1e-9);
});

test("derived CAGR uses the same 365-day basis as the Python service", () => {
  // 365 calendar days from 100 to 121 is exactly 21% CAGR.
  const window = navWindow([100, 121], { dates: ["2020-01-01", "2020-12-31"] });
  const metrics = computeWindowMetrics(window);
  assert.ok(Math.abs(metrics.cagr - 21) < 0.1, `got ${metrics.cagr}`);
});

test("derived Sharpe matches a hand calculation", () => {
  // Twenty returns are the backend's minimum for an annualized Sharpe ratio.
  const returns = Array.from({ length: 20 }, (_, index) => (
    index % 3 === 1 ? -0.005 : 0.01 + index / 10_000
  ));
  const values = [100];
  returns.forEach((value) => values.push(values.at(-1) * (1 + value)));
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
  const expected = (mean / Math.sqrt(variance)) * Math.sqrt(252);

  const metrics = computeWindowMetrics(navWindow(values));
  assert.ok(Math.abs(metrics.sharpe - expected) < 1e-9, `${metrics.sharpe} vs ${expected}`);
});

test("max drawdown tracks the running peak, never the previous point", () => {
  const window = navWindow([100, 120, 90, 100]);
  const metrics = computeWindowMetrics(window);
  // 90 against a running peak of 120 is -25%, not -10% against 100.
  assert.equal(metrics.maxDrawdown, -25);
});

test("a missing window reports nothing rather than zero", () => {
  const metrics = computeWindowMetrics(null);
  assert.deepEqual(metrics, {
    totalReturn: null,
    cagr: null,
    annualizedVolatility: null,
    maxDrawdown: null,
    sharpe: null,
    sortino: null,
    benchmarks: { spy: null, spmo: null },
    benchmarkRelative: { spy: null, spmo: null },
    source: "none",
  });
});

test("a zero-variance window has no Sharpe ratio", () => {
  const metrics = computeWindowMetrics(navWindow(Array.from({ length: 22 }, () => 100)));
  assert.equal(metrics.sharpe, null);
});

test("Sortino uses downside deviation over every return", () => {
  const returns = Array.from({ length: 20 }, (_, index) => (
    index % 4 === 0 ? -0.01 : 0.012
  ));
  const values = [100];
  returns.forEach((value) => values.push(values.at(-1) * (1 + value)));
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const downsideDeviation = Math.sqrt(
    returns.reduce((total, value) => total + Math.min(value, 0) ** 2, 0) / returns.length,
  );
  const expected = (mean / downsideDeviation) * Math.sqrt(252);
  const metrics = computeWindowMetrics(navWindow(values));
  assert.ok(Math.abs(metrics.sortino - expected) < 1e-9);
});

test("benchmark beta, correlation and tracking error use aligned daily returns", () => {
  const returns = Array.from({ length: 24 }, (_, index) => 0.004 + Math.sin(index) * 0.003);
  const benchmarkReturns = returns.map((value, index) => value * 0.7 + (index % 2 ? 0.0005 : -0.0005));
  const values = [100];
  const benchmark = [100];
  returns.forEach((value, index) => {
    values.push(values.at(-1) * (1 + value));
    benchmark.push(benchmark.at(-1) * (1 + benchmarkReturns[index]));
  });
  const window = {
    dates: values.map((_, index) => new Date(Date.UTC(2020, 0, 2 + index)).toISOString().slice(0, 10)),
    strategy: values,
    spy: benchmark,
    spmo: [],
  };
  const relative = computeWindowMetrics(window).benchmarkRelative.spy;
  const meanStrategy = returns.reduce((total, value) => total + value, 0) / returns.length;
  const meanBenchmark = benchmarkReturns.reduce((total, value) => total + value, 0) / benchmarkReturns.length;
  const covariance = returns.reduce(
    (total, value, index) => total + (value - meanStrategy) * (benchmarkReturns[index] - meanBenchmark),
    0,
  ) / (returns.length - 1);
  const benchmarkVariance = benchmarkReturns.reduce(
    (total, value) => total + (value - meanBenchmark) ** 2,
    0,
  ) / (benchmarkReturns.length - 1);
  const correlation = covariance
    / Math.sqrt(
      benchmarkVariance
      * returns.reduce((total, value) => total + (value - meanStrategy) ** 2, 0)
      / (returns.length - 1),
    );
  const active = returns.map((value, index) => value - benchmarkReturns[index]);
  const activeMean = active.reduce((total, value) => total + value, 0) / active.length;
  const activeVariance = active.reduce((total, value) => total + (value - activeMean) ** 2, 0) / (active.length - 1);
  assert.ok(Math.abs(relative.beta - covariance / benchmarkVariance) < 1e-9);
  assert.ok(Math.abs(relative.correlation - correlation) < 1e-9);
  assert.ok(Math.abs(relative.trackingError - Math.sqrt(activeVariance) * Math.sqrt(252) * 100) < 1e-9);
});

test("duration uses completed calendar months from the effective backtest dates", () => {
  assert.equal(formatBacktestDuration("2018-02-05", "2019-08-20"), "1y 6m");
  assert.equal(formatBacktestDuration("2019-01-02", "2024-04-02"), "5y 3m");
  assert.equal(formatBacktestDuration("2018-02-05", "2026-09-20"), "8y 7m");
  assert.equal(formatBacktestDuration("2024-03-15", "2024-07-14"), "3m");
  assert.equal(formatBacktestDuration("2024-03-15", "2024-03-20"), "<1m");
});

test("duration reports no value for missing or reversed dates", () => {
  assert.equal(formatBacktestDuration(null, "2024-01-01"), "—");
  assert.equal(formatBacktestDuration("2024-02-01", "2024-01-01"), "—");
});

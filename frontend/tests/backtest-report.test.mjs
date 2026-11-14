import assert from "node:assert/strict";
import test from "node:test";
import {
  applyInflationAdjustment,
  calculateBacktestReport,
  calculateCumulativeSeries,
  calculatePeriodReturns,
  calculateXirr,
  getBacktestAvailability,
  simulateCashflows,
} from "../src/utils/backtestReport.js";

const dates = ["2020-01-02", "2020-01-31", "2020-02-03", "2020-02-28", "2020-03-02", "2020-03-31", "2020-04-01", "2020-04-30"];
const strategy = [100, 110, 99, 118.8, 118.8, 130.68, 124.146, 136.5606];

function account(frequency) {
  return simulateCashflows({
    dates,
    strategy,
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: frequency,
  });
}

test("monthly contributions land at the first observation of a new month", () => {
  const result = account("monthly");
  assert.equal(result.totalContributions, 3_000);
  // Jan 2 has no contribution because it is the account opening observation.
  assert.equal(result.timeline[1].value, 11_000);
  assert.equal(result.timeline[2].value, 10_900);
  assert.ok(result.finalValue > 13_000);
});

test("quarterly and annual cashflows use the same close-timing convention", () => {
  const quarterly = account("quarterly");
  const annually = simulateCashflows({
    dates: ["2020-12-30", "2020-12-31", "2021-01-04", "2021-01-05"],
    strategy: [100, 110, 110, 121],
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "annually",
  });
  assert.equal(quarterly.totalContributions, 1_000);
  assert.equal(annually.totalContributions, 1_000);
  assert.equal(annually.timeline[2].value, 12_000);
  assert.ok(Math.abs(annually.timeline[3].value - 13_200) < 1e-9);
});

test("external contributions do not inflate time-weighted return", () => {
  const withFlows = account("monthly");
  const withoutFlows = simulateCashflows({ dates, strategy, startsAtBacktestOrigin: false });
  assert.equal(withFlows.timeWeightedReturnPct, withoutFlows.timeWeightedReturnPct);
  assert.ok(Math.abs(withoutFlows.timeWeightedReturnPct - 36.5606) < 1e-6);
});

test("tooltip balances use the same actual account simulation for all three series", () => {
  const series = calculateCumulativeSeries(
    {
      dates,
      strategy,
      spy: strategy.map((value) => 100 + (value - 100) / 2),
      spmo: strategy.map((value) => 100 + (value - 100) / 3),
      startsAtBacktestOrigin: false,
    },
    {
      initialCapital: 10_000,
      cashflowEnabled: true,
      contributionAmount: 1_000,
      contributionFrequency: "monthly",
    },
  );

  const strategyAccount = simulateCashflows({
    dates,
    strategy,
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
    startsAtBacktestOrigin: false,
  });
  assert.deepEqual(series.strategy.values, strategyAccount.timeline.map((point) => point.value));
  assert.ok(Math.abs(series.strategy.returns.at(-1) - 36.5606) < 1e-9);
  assert.ok(series.spy.values.at(-1) < series.strategy.values.at(-1));
  assert.ok(series.spmo.values.at(-1) < series.spy.values.at(-1));
  assert.equal(series.spy.values.length, dates.length);
  assert.equal(series.spmo.returns.length, dates.length);
  assert.ok(series.strategy.values.at(-1) > 13_000);
});

test("XIRR is solved from actual dated investor cashflows", () => {
  const xirr = calculateXirr([
    { date: "2020-01-01", amount: -10_000 },
    { date: "2021-01-01", amount: 11_000 },
  ]);
  assert.ok(Math.abs(xirr - 9.97136) < 0.01, `got ${xirr}`);
});

test("period returns use beginning and ending values, not summed daily returns", () => {
  const rows = calculatePeriodReturns({
    dates: ["2020-01-02", "2020-03-31", "2020-04-01", "2020-06-30"],
    strategy: [100, 110, 99, 118.8],
    spy: [100, 105, 105, 115.5],
    spmo: [100, 102, 102, 112.2],
    frequency: "quarterly",
  });
  assert.equal(rows.length, 2);
  assert.ok(Math.abs(rows[0].strategy - 10) < 1e-9);
  assert.ok(Math.abs(rows[1].strategy - 8) < 1e-9);
  assert.ok(Math.abs(rows[1].spy - 10) < 1e-9);
  assert.ok(Math.abs(rows[1].spmo - 10) < 1e-9);
});

test("monthly returns link the prior month-end value to the current month-end value", () => {
  const rows = calculatePeriodReturns({
    dates: ["2020-01-02", "2020-01-31", "2020-02-03", "2020-02-28"],
    strategy: [100, 105, 95, 114],
    frequency: "monthly",
  });
  assert.equal(rows.length, 2);
  assert.ok(Math.abs(rows[0].strategy - 5) < 1e-9);
  assert.ok(Math.abs(rows[1].strategy - (114 / 105 - 1) * 100) < 1e-9);
});

test("annual rows label a partial opening year and filter current YTD separately", () => {
  const rows = calculatePeriodReturns({
    dates: ["2020-04-01", "2020-12-31", "2021-01-04", "2021-06-30"],
    strategy: [100, 120, 120, 132],
    frequency: "annual",
  });
  assert.equal(rows[0].partialStart, true);
  assert.equal(rows[1].ytd, true);
  assert.ok(Math.abs(rows[0].strategy - 20) < 1e-9);
  assert.ok(Math.abs(rows[1].strategy - 10) < 1e-9);
});

test("the opening period includes the initial entry transaction cost", () => {
  const rows = calculatePeriodReturns({
    dates: ["2020-01-02", "2020-12-31", "2021-01-04", "2021-12-31"],
    strategy: [99.9, 120, 120, 132],
    spy: [100, 110, 110, 121],
    smpo: [],
    frequency: "annual",
    startsAtBacktestOrigin: true,
  });
  assert.ok(Math.abs(rows[0].strategy - 20) < 1e-9);
  assert.ok(Math.abs(rows[0].strategy - (120 / 99.9 - 1) * 100) > 0.05);

  const monthly = calculatePeriodReturns({
    dates: ["2020-01-02", "2020-01-31", "2020-02-03", "2020-02-28"],
    strategy: [99.9, 105, 105, 110],
    frequency: "monthly",
    startsAtBacktestOrigin: true,
  });
  assert.ok(Math.abs(monthly[0].strategy - 5) < 1e-9);
});

test("the report separates final account value, contributions and investment return", () => {
  const report = calculateBacktestReport(
    {
      dates,
      strategy,
      spy: [100, 101, 101, 102, 102, 103, 103, 104],
      spmo: [100, 101, 101, 102, 102, 103, 103, 104],
      startsAtBacktestOrigin: false,
    },
    {
      initialCapital: 10_000,
      cashflowEnabled: true,
      contributionAmount: 1_000,
      contributionFrequency: "monthly",
    },
  );
  assert.equal(report.totalContributions, 3_000);
  assert.notEqual(report.finalValue, report.timeWeightedReturnPct);
  assert.ok(
    Math.abs(report.netProfitLoss - (report.finalValue - report.initialCapital - report.totalContributions)) < 1e-9,
  );
  assert.ok(Math.abs(report.relativeToSpyPct - (report.timeWeightedReturnPct - 4)) < 1e-9);
});

test("balances use the requested initial capital and the actual ending account value", () => {
  const windows = [
    { dates, strategy, start: 0, end: dates.length },
    { dates: dates.slice(0, 5), strategy: strategy.slice(0, 5), start: 0, end: 5 },
    { dates: dates.slice(2), strategy: strategy.slice(2), start: 2, end: dates.length },
  ];
  for (const capital of [10_000, 25_000, 1_234_567]) {
    for (const window of windows) {
      const result = simulateCashflows({
        dates: window.dates,
        strategy: window.strategy,
        initialCapital: capital,
        startsAtBacktestOrigin: false,
      });
      const expectedEnd = capital * window.strategy.at(-1) / window.strategy[0];
      assert.equal(result.initialCapital, capital);
      assert.ok(Math.abs(result.finalValue - expectedEnd) < 1e-9);
    }
  }
});

test("cashflow contributions increase the ending balance without changing start balance or return", () => {
  const withFlows = account("monthly");
  const withoutFlows = simulateCashflows({
    dates,
    strategy,
    initialCapital: 10_000,
    contributionEnabled: false,
    startsAtBacktestOrigin: false,
  });
  assert.equal(withFlows.initialCapital, 10_000);
  assert.equal(withoutFlows.initialCapital, 10_000);
  assert.ok(withFlows.finalValue > withoutFlows.finalValue);
  assert.equal(withFlows.timeWeightedReturnPct, withoutFlows.timeWeightedReturnPct);
});

test("unsupported dividend and inflation modes report a limitation", () => {
  assert.equal(getBacktestAvailability({ reinvestDividends: true, inflationAdjusted: false }).available, true);
  assert.match(getBacktestAvailability({ reinvestDividends: false, inflationAdjusted: false }).title, /unavailable/);
  assert.match(getBacktestAvailability({ reinvestDividends: true, inflationAdjusted: true }).title, /unavailable/);
});

test("inflation reprices wealth with only CPI observations already published", () => {
  const cpi = {
    available: true,
    series_id: "CPIAUCNS",
    source: "BLS via FRED",
    observations: [
      { date: "2019-12-01", value: 100, available_from: "2020-01-15" },
      { date: "2020-01-01", value: 100, available_from: "2020-02-15" },
      { date: "2020-02-01", value: 101, available_from: "2020-03-15" },
    ],
  };
  const adjusted = applyInflationAdjustment(
    {
      dates: ["2020-01-20", "2020-02-03", "2020-03-02", "2020-04-01"],
      strategy: [100, 105, 110, 115],
      spy: [100, 102, 104, 106],
      spmo: [100, 103, 106, 109],
      drawdown: [0, 0, 0, 0],
    },
    cpi,
  );
  assert.equal(adjusted.inflation.available, true);
  assert.deepEqual(adjusted.strategy, [100, 105, 110, 115 / 1.01]);
  assert.equal(adjusted.inflation.baseObservation.value, 100);
  assert.equal(adjusted.purchasingPower.at(-1), 100 / 101);
  assert.ok(adjusted.drawdown.every((value) => value <= 0));
});

test("real contributions and XIRR use base-date purchasing power", () => {
  const result = simulateCashflows({
    dates,
    strategy,
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
    purchasingPower: [1, 1, 0.99, 0.99, 0.98, 0.98, 0.97, 0.97],
  });
  assert.equal(result.nominalTotalContributions, 3_000);
  assert.ok(result.totalContributions < 3_000);
  assert.equal(result.inflationAdjusted, true);
  assert.notEqual(result.moneyWeightedReturnPct, null);
});

test("inflation-adjusted balances and return use one real-dollar basis", () => {
  const cpi = {
    available: true,
    observations: [
      { date: "2019-11-01", value: 100, available_from: "2019-12-15" },
      { date: "2019-12-01", value: 100, available_from: "2020-01-15" },
      { date: "2020-01-01", value: 100, available_from: "2020-02-15" },
      { date: "2020-02-01", value: 101, available_from: "2020-03-15" },
      { date: "2020-03-01", value: 102, available_from: "2020-04-15" },
    ],
  };
  const adjusted = applyInflationAdjustment({
    dates,
    strategy,
    spy: strategy,
    spmo: strategy,
    drawdown: strategy.map(() => 0),
  }, cpi);
  const nominal = simulateCashflows({
    dates,
    strategy,
    initialCapital: 10_000,
    startsAtBacktestOrigin: false,
  });
  const real = simulateCashflows({
    dates: adjusted.dates,
    strategy: adjusted.strategy,
    initialCapital: 10_000,
    startsAtBacktestOrigin: false,
    purchasingPower: adjusted.purchasingPower,
  });
  assert.equal(real.initialCapital, 10_000);
  assert.ok(Math.abs(real.finalValue - nominal.finalValue * adjusted.purchasingPower.at(-1)) < 1e-9);
  assert.ok(
    Math.abs(real.timeWeightedReturnPct - (adjusted.strategy.at(-1) / adjusted.strategy[0] - 1) * 100) < 1e-9,
  );
  assert.notEqual(real.finalValue, nominal.finalValue);
});

test("dividend-exclusive mode requires both price series and complete actions", () => {
  const block = {
    strategy: [100, 101],
    priceStrategy: [100, 100.5],
    priceSpy: [100, 100.2],
    priceSpmo: [100, 100.4],
    dividendCoverage: { incomplete_securities: 0, affected_tickers: [] },
  };
  assert.equal(getBacktestAvailability({
    reinvestDividends: false,
    inflationAdjusted: false,
    block,
  }).available, true);
  block.dividendCoverage.incomplete_securities = 1;
  block.dividendCoverage.affected_tickers = ["TEST"];
  assert.match(getBacktestAvailability({
    reinvestDividends: false,
    inflationAdjusted: false,
    block,
  }).title, /incomplete/i);
});

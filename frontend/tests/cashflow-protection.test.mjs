import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBacktestReport,
  calculateCumulativeSeries,
  simulateCashflows,
} from "../src/utils/backtestReport.js";
import { buildBacktestExportData } from "../src/utils/backtestExport.js";

const monthDates = [
  "2020-01-02",
  "2020-01-31",
  "2020-02-03",
  "2020-02-28",
  "2020-03-02",
  "2020-03-31",
  "2020-04-01",
];

function simulate(overrides = {}) {
  return simulateCashflows({
    dates: monthDates.slice(0, 4),
    strategy: monthDates.slice(0, 4).map(() => 100),
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
    cashflowDirection: "inflow",
    ...overrides,
  });
}

function assertProtected(result) {
  assert.ok(result.timeline.every((point) => (
    Number.isFinite(point.value) && point.value >= 0
  )));
  assert.ok(Number.isFinite(result.finalValue) && result.finalValue >= 0);
  assert.ok(Number.isFinite(result.netProfitLoss));
  assert.ok(result.timeWeightedReturnPct === null || Number.isFinite(result.timeWeightedReturnPct));
}

test("A. normal inflow increases the account without changing investment return", () => {
  const result = simulate();
  assert.equal(result.timeline[2].value, 11_000);
  assert.equal(result.finalValue, 11_000);
  assert.equal(result.totalInflows, 1_000);
  assert.equal(result.actualOutflows, 0);
  assert.equal(result.unpaidOutflows, 0);
  assertProtected(result);
});

test("B. normal outflow withdraws the requested amount from portfolio value", () => {
  const result = simulate({ cashflowDirection: "outflow" });
  assert.equal(result.timeline[2].value, 9_000);
  assert.equal(result.finalValue, 9_000);
  assert.equal(result.requestedOutflows, 1_000);
  assert.equal(result.actualOutflows, 1_000);
  assert.equal(result.unpaidOutflows, 0);
  assertProtected(result);
});

test("C. an outflow larger than investment gains can use principal", () => {
  const result = simulateCashflows({
    dates: monthDates.slice(0, 3),
    strategy: [100, 110, 121],
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 5_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
  });
  assert.equal(result.actualOutflows, 5_000);
  assert.ok(Math.abs(result.finalValue - 7_100) < 1e-9);
  assert.equal(result.unpaidOutflows, 0);
  assertProtected(result);
});

test("D. an outflow above available capital is capped and the shortfall is recorded", () => {
  const result = simulate({ cashflowDirection: "outflow", contributionAmount: 12_000 });
  assert.equal(result.requestedOutflows, 12_000);
  assert.equal(result.actualOutflows, 10_000);
  assert.equal(result.unpaidOutflows, 2_000);
  assert.equal(result.finalValue, 0);
  assert.deepEqual(result.cashflowEvents[0], {
    date: "2020-02-03",
    direction: "outflow",
    requestedAmount: 12_000,
    actualAmount: 10_000,
    unpaidAmount: 2_000,
    endingBalance: 0,
  });
  assertProtected(result);
});

test("E. an outflow equal to available capital produces an exact zero balance", () => {
  const result = simulate({ cashflowDirection: "outflow", contributionAmount: 10_000 });
  assert.equal(result.actualOutflows, 10_000);
  assert.equal(result.unpaidOutflows, 0);
  assert.equal(result.finalValue, 0);
  assert.equal(result.timeline[2].value, 0);
  assertProtected(result);
});

test("F. market growth cannot create value from a depleted balance or a zero NAV", () => {
  const result = simulateCashflows({
    dates: ["2020-12-30", "2020-12-31", "2021-01-04", "2021-01-05", "2021-02-01"],
    strategy: [100, 100, 100, 0, 100],
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 10_000,
    contributionFrequency: "annually",
    cashflowDirection: "outflow",
  });
  assert.equal(result.timeline[2].value, 0);
  assert.deepEqual(result.timeline.slice(2).map((point) => point.value), [0, 0, 0]);
  assert.equal(result.finalValue, 0);
  assertProtected(result);

  const zeroOrigin = simulateCashflows({
    dates: ["2020-01-02", "2020-01-31"],
    strategy: [0, 100],
    initialCapital: 10_000,
    contributionEnabled: false,
  });
  assert.equal(zeroOrigin.finalValue, 0);
  assert.equal(zeroOrigin.timeWeightedReturnPct, null);
  assertProtected(zeroOrigin);
});

test("G. a large market decline cannot push a long-only account below zero", () => {
  const result = simulateCashflows({
    dates: monthDates.slice(0, 5),
    strategy: [100, 80, 20, 1, 0.1],
    initialCapital: 10_000,
    contributionEnabled: false,
  });
  assert.equal(result.finalValue, 10);
  assertProtected(result);
});

test("H. repeated scheduled outflows stop executing once the account is depleted", () => {
  const result = simulate({
    dates: monthDates,
    strategy: monthDates.map(() => 100),
    initialCapital: 1_000,
    contributionAmount: 600,
    cashflowDirection: "outflow",
  });
  assert.equal(result.cashflowEvents.length, 3);
  assert.deepEqual(
    result.cashflowEvents.map((event) => [event.actualAmount, event.unpaidAmount, event.endingBalance]),
    [[600, 0, 400], [400, 200, 0], [0, 600, 0]],
  );
  assert.equal(result.requestedOutflows, 1_800);
  assert.equal(result.actualOutflows, 1_000);
  assert.equal(result.unpaidOutflows, 800);
  assert.equal(result.finalValue, 0);
  assertProtected(result);
});

test("I. disabled cashflows produce no scheduled cashflow events", () => {
  const result = simulate({ contributionEnabled: false, cashflowDirection: "outflow" });
  assert.equal(result.cashflowEvents.length, 0);
  assert.equal(result.requestedOutflows, 0);
  assert.equal(result.actualOutflows, 0);
  assert.equal(result.unpaidOutflows, 0);
  assert.equal(result.finalValue, 10_000);
  assertProtected(result);
});

test("J. XIRR and net P&L use actual withdrawals and exclude unpaid withdrawals", () => {
  const window = {
    dates: monthDates.slice(0, 4),
    strategy: monthDates.slice(0, 4).map(() => 100),
    startsAtBacktestOrigin: false,
  };
  const config = {
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 12_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
  };
  const report = calculateBacktestReport(window, config);

  assert.equal(report.netProfitLoss, 0);
  assert.equal(
    report.netProfitLoss,
    report.finalValue + report.actualOutflows - report.initialCapital - report.totalInflows,
  );
  assert.equal(report.actualOutflows, 10_000);
  assert.equal(report.unpaidOutflows, 2_000);
  assert.deepEqual(
    report.investorFlows.filter((flow) => flow.date !== "2020-01-02"),
    [
      { date: "2020-02-03", amount: 10_000 },
      { date: "2020-02-28", amount: 0 },
    ],
  );
  assert.ok(Math.abs(report.moneyWeightedReturnPct) < 1e-8);
  assertProtected(report);
});

test("K. inflation-adjusted outflows use base-date purchasing power and respect the floor", () => {
  const dates = ["2020-01-20", "2020-02-03", "2020-03-02", "2020-04-01"];
  const result = simulateCashflows({
    dates,
    strategy: dates.map(() => 100),
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 3_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
    purchasingPower: [1, 1, 0.8, 0.7],
  });
  assert.deepEqual(
    result.cashflowEvents.map((event) => [event.requestedAmount, event.actualAmount, event.endingBalance]),
    [[3_000, 3_000, 7_000], [2_400, 2_400, 4_600], [2_100, 2_100, 2_500]],
  );
  assert.equal(result.unpaidOutflows, 0);
  assertProtected(result);

  const depleted = simulateCashflows({
    dates,
    strategy: dates.map(() => 100),
    initialCapital: 2_000,
    contributionEnabled: true,
    contributionAmount: 3_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
    purchasingPower: [1, 1, 0.8, 0.7],
  });
  assert.equal(depleted.cashflowEvents[0].actualAmount, 2_000);
  assert.equal(depleted.cashflowEvents[0].unpaidAmount, 1_000);
  assert.equal(depleted.finalValue, 0);
  assertProtected(depleted);
});

test("L. all cumulative series use the protected shared simulator and match the report", () => {
  const window = {
    dates: monthDates.slice(0, 6),
    strategy: [100, 50, 50, 200, 200, 400],
    spy: [100, 100, 100, 100, 100, 100],
    spmo: [100, 110, 90, 180, 90, 180],
    startsAtBacktestOrigin: false,
  };
  const config = {
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 20_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
  };
  const series = calculateCumulativeSeries(window, config);

  for (const id of ["strategy", "spy", "spmo"]) {
    const account = simulateCashflows({
      dates: window.dates,
      strategy: window[id],
      initialCapital: config.initialCapital,
      contributionEnabled: config.cashflowEnabled,
      contributionAmount: config.contributionAmount,
      contributionFrequency: config.contributionFrequency,
      cashflowDirection: config.cashflowDirection,
      startsAtBacktestOrigin: false,
    });
    assert.deepEqual(series[id].values, account.timeline.map((point) => point.value));
    assert.deepEqual(series[id].cashflowEvents, account.cashflowEvents);
    assert.ok(series[id].values.every((value) => Number.isFinite(value) && value >= 0));
  }
  assert.equal(series.strategy.cashflowEvents[0].actualAmount, 5_000);
  assert.equal(series.spy.cashflowEvents[0].actualAmount, 10_000);
  assert.equal(series.spmo.cashflowEvents[0].actualAmount, 9_000);
  assert.equal(calculateBacktestReport(window, config).finalValue, series.strategy.values.at(-1));
});

test("Cash Flow export reports requested, actual and unpaid outflows with the simulated balance", () => {
  const window = {
    dates: monthDates.slice(0, 4),
    strategy: monthDates.slice(0, 4).map(() => 100),
    spy: monthDates.slice(0, 4).map(() => 100),
    spmo: monthDates.slice(0, 4).map(() => 100),
    startsAtBacktestOrigin: false,
  };
  const config = {
    startDate: window.dates[0],
    endDate: window.dates.at(-1),
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 12_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
    rebalanceFrequency: "semiannual",
    reinvestDividends: true,
    inflationAdjusted: false,
    includeYtd: true,
    portfolio: "top100",
  };
  const data = buildBacktestExportData({
    window,
    block: { end: window.dates.at(-1) },
    config,
    exportedAt: "2026-11-14T00:00:00Z",
  });
  const sheet = data.workbookSheets.find((entry) => entry.name === "Cash Flows");
  assert.deepEqual(sheet.rows[1], [
    "2020-01-02",
    10_000,
    null,
    null,
    null,
    10_000,
  ]);
  assert.deepEqual(sheet.rows[2], [
    "2020-02-03",
    0,
    12_000,
    10_000,
    2_000,
    0,
  ]);
});

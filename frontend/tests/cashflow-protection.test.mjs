import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBacktestReport,
  calculateCumulativeSeries,
  normalizeBackendCashflowAccounts,
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
    balanceBefore: 10_000,
    endingHoldingsValue: 0,
    availableCash: 0,
    units: 0,
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
  // The account closes after the second withdrawal, so the schedule stops
  // instead of re-requesting an amount that could never be paid.
  assert.equal(result.cashflowEvents.length, 2);
  assert.deepEqual(
    result.cashflowEvents.map((event) => [event.actualAmount, event.unpaidAmount, event.endingBalance]),
    [[600, 0, 400], [400, 200, 0]],
  );
  assert.equal(result.requestedOutflows, 1_200);
  assert.equal(result.actualOutflows, 1_000);
  assert.equal(result.unpaidOutflows, 200);
  assert.equal(result.fullyDepleted, true);
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

test("only the strategy pays its entry cost; benchmarks start with the full capital", () => {
  const series = calculateCumulativeSeries({
    dates: monthDates.slice(0, 3),
    strategy: [99.9, 110, 121],
    spy: [100, 101, 102],
    spmo: [100, 99, 103],
    startsAtBacktestOrigin: true,
  }, {
    initialCapital: 10_000,
    cashflowEnabled: false,
  });
  assert.equal(series.strategy.values[0], 9_990);
  assert.equal(series.spy.values[0], 10_000);
  assert.equal(series.spmo.values[0], 10_000);
  assert.ok(Math.abs(series.strategy.returns.at(-1) - 21) < 1e-9);
  assert.ok(Math.abs(series.spy.returns.at(-1) - 2) < 1e-9);
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

test("matching Python account simulations drive the UI report and chart", () => {
  const dates = monthDates.slice(0, 3);
  const config = {
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
    cashflowDirection: "inflow",
  };
  const backend = {
    config: {
      initial_capital: 10_000,
      enabled: true,
      amount: 1_000,
      frequency: "monthly",
      direction: "inflow",
    },
    accounts: {
      strategy: {
        initial_capital: 10_000,
        final_value: 11_000,
        ending_holdings_value: 11_000,
        ending_cash: 0,
        remaining_units: 110,
        total_inflows: 1_000,
        requested_outflows: 0,
        actual_outflows: 0,
        unpaid_outflows: 0,
        net_cashflow: 1_000,
        net_profit_loss: 0,
        gross_invested_capital: 11_000,
        time_weighted_return_pct: 0,
        money_weighted_return_pct: 0,
        balances: [10_000, 10_000, 11_000],
        holdings_values: [10_000, 10_000, 11_000],
        cash_values: [0, 0, 0],
        units: [100, 100, 110],
        twr_values: [0, 0, 0],
        daily_returns: [0, 0],
        events: [{
          date: dates[1],
          direction: "inflow",
          requested_amount: 1_000,
          actual_amount: 1_000,
          unpaid_amount: 0,
          balance_before: 10_000,
          balance_after: 11_000,
          units: 110,
          available_cash: 0,
        }],
        investor_flows: [
          { date: dates[0], amount: -10_000 },
          { date: dates[1], amount: -1_000 },
          { date: dates[2], amount: 11_000 },
        ],
      },
      spy: {
        balances: [10_000, 10_000, 11_000],
        holdings_values: [10_000, 10_000, 11_000],
        cash_values: [0, 0, 0],
        units: [100, 100, 110],
        twr_values: [0, 0, 0],
      },
      spmo: {
        balances: [10_000, 10_000, 11_000],
        holdings_values: [10_000, 10_000, 11_000],
        cash_values: [0, 0, 0],
        units: [100, 100, 110],
        twr_values: [0, 0, 0],
      },
    },
  };
  const window = {
    dates,
    strategy: [100, 100, 100],
    spy: [100, 101, 102],
    spmo: [100, 99, 103],
    startsAtBacktestOrigin: false,
  };
  const normalized = normalizeBackendCashflowAccounts(backend, config, dates);
  assert.equal(normalized.strategy.finalValue, 11_000);
  assert.equal(normalized.strategy.cashflowEvents[0].endingBalance, 11_000);
  assert.equal(calculateBacktestReport(window, config, backend).finalValue, 11_000);
  const series = calculateCumulativeSeries(window, config, backend);
  assert.deepEqual(series.strategy.values, backend.accounts.strategy.balances);
  assert.deepEqual(series.spy.values, backend.accounts.spy.balances);

  const mismatched = { ...backend, config: { ...backend.config, amount: 2_000 } };
  assert.equal(normalizeBackendCashflowAccounts(mismatched, config, dates), null);
});

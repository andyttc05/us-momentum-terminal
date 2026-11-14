/**
 * Independent numerical tests for the browser account simulation.
 *
 * This is the mirror of `data-service/tests/test_cashflow_accounting.py`: the
 * same hand-calculated scenario table is asserted against the JavaScript engine,
 * so the Python service and the browser fallback cannot drift apart without one
 * of the two suites failing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDrawdown,
  auditAccount,
  buildBacktestAnalysis,
  buildPortfolioAccounts,
  calculatePeriodReturns,
  sliceAccountSeries,
  simulateCashflows,
} from "../src/utils/backtestReport.js";

// Month-boundary observations so the monthly schedule fires on 2020-02-03 and
// 2020-03-02 (the first observation of each new calendar period).
const DATES = ["2020-01-02", "2020-01-31", "2020-02-03", "2020-02-28", "2020-03-02", "2020-03-31"];
const RISING = [100, 110, 110, 121, 121, 133.1];
const FALLING = [100, 90, 90, 81, 81, 72.9];
const FLAT = [100, 100, 100, 100, 100, 100];

function run(nav, {
  direction = "inflow",
  amount = 1_000,
  enabled = true,
  capital = 10_000,
  dates = DATES,
} = {}) {
  const account = simulateCashflows({
    dates: dates.slice(0, nav.length),
    strategy: nav,
    initialCapital: capital,
    contributionEnabled: enabled,
    contributionAmount: amount,
    contributionFrequency: "monthly",
    cashflowDirection: direction,
    startsAtBacktestOrigin: true,
  });
  // The engine returns a dated timeline; chart consumers read the derived
  // balance/return arrays, so the helper exposes the same shape.
  return {
    ...account,
    values: account.timeline.map((point) => point.value),
    returns: account.twrValues,
  };
}

const money = (values) => values.map((value) => Number(value.toFixed(6)));

function clean(result, dates = DATES) {
  return auditAccount(result, dates.slice(0, result.values.length));
}

test("01. flat market without cashflows keeps the capital and reports no return", () => {
  const result = run(FLAT, { enabled: false });
  assert.deepEqual(money(result.values), [10_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
  assert.equal(result.cashflowEvents.length, 0);
  assert.equal(result.timeWeightedReturnPct, 0);
  assert.ok(Math.abs(result.moneyWeightedReturnPct) < 1e-6);
  assert.deepEqual(result.balanceDrawdown, [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(clean(result), []);
});

test("02. flat market with regular inflows grows only by the deposits", () => {
  const result = run(FLAT);
  assert.equal(result.finalValue, 12_000);
  assert.equal(result.totalInflows, 2_000);
  assert.equal(result.timeWeightedReturnPct, 0);
  assert.equal(result.netProfitLoss, 0);
  assert.ok(Math.abs(result.moneyWeightedReturnPct) < 1e-6);
  assert.deepEqual(clean(result), []);
});

test("03. flat market with regular outflows shrinks only by the withdrawals", () => {
  const result = run(FLAT, { direction: "outflow" });
  assert.equal(result.finalValue, 8_000);
  assert.equal(result.actualOutflows, 2_000);
  assert.equal(result.unpaidOutflows, 0);
  assert.equal(result.timeWeightedReturnPct, 0);
  assert.ok(Math.abs(result.moneyWeightedReturnPct) < 1e-6);
  assert.ok(result.maxBalanceDrawdownPct < -15);
  assert.deepEqual(clean(result), []);
});

test("04. positive market with inflows compounds on the contributed capital", () => {
  const result = run(RISING);
  assert.deepEqual(money(result.values), [10_000, 11_000, 12_000, 13_200, 14_200, 15_620]);
  assert.ok(Math.abs(result.timeWeightedReturnPct - 33.1) < 1e-9);
  assert.ok(Math.abs(result.netProfitLoss - 3_620) < 1e-6);
  assert.deepEqual(clean(result), []);
});

test("05. positive market with outflows removes units, not return", () => {
  const result = run(RISING, { direction: "outflow" });
  assert.deepEqual(money(result.values), [10_000, 11_000, 10_000, 11_000, 10_000, 11_000]);
  assert.ok(Math.abs(result.timeWeightedReturnPct - 33.1) < 1e-9);
  assert.equal(result.actualOutflows, 2_000);
  assert.ok(Math.abs(result.netProfitLoss - 3_000) < 1e-6);
  assert.deepEqual(clean(result), []);
});

test("06. negative market with inflows cannot hide the loss", () => {
  const result = run(FALLING);
  assert.deepEqual(money(result.values), [10_000, 9_000, 10_000, 9_000, 10_000, 9_000]);
  assert.ok(Math.abs(result.timeWeightedReturnPct + 27.1) < 1e-9);
  assert.ok(Math.abs(result.netProfitLoss + 3_000) < 1e-6);
  assert.deepEqual(clean(result), []);
});

test("07. negative market with outflows", () => {
  const result = run(FALLING, { direction: "outflow" });
  assert.deepEqual(money(result.values), [10_000, 9_000, 8_000, 7_200, 6_200, 5_580]);
  assert.ok(Math.abs(result.timeWeightedReturnPct + 27.1) < 1e-9);
  assert.ok(Math.abs(result.netProfitLoss + 2_420) < 1e-6);
  assert.deepEqual(clean(result), []);
});

test("08. severe crash with withdrawals caps execution and records the shortfall", () => {
  const result = run([100, 50, 50, 25, 25, 12.5], { direction: "outflow", amount: 6_000 });
  assert.deepEqual(money(result.values.slice(0, 3)), [10_000, 5_000, 0]);
  assert.equal(result.requestedOutflows, 12_000);
  assert.equal(result.actualOutflows, 5_000);
  assert.equal(result.unpaidOutflows, 7_000);
  assert.equal(result.finalValue, 0);
  assert.equal(result.maxBalanceDrawdownPct, -100);
  assert.deepEqual(clean(result), []);
});

test("09. an outflow above the balance is capped at the balance", () => {
  const result = run(FLAT, { direction: "outflow", amount: 12_000 });
  assert.equal(result.requestedOutflows, 24_000);
  assert.equal(result.actualOutflows, 10_000);
  assert.equal(result.unpaidOutflows, 14_000);
  assert.equal(result.finalValue, 0);
  const [first] = result.cashflowEvents;
  assert.equal(first.requestedAmount, 12_000);
  assert.equal(first.actualAmount, 10_000);
  assert.equal(first.unpaidAmount, 2_000);
  assert.equal(first.endingHoldingsValue, 0);
  assert.deepEqual(clean(result), []);
});

test("10. an outflow equal to the balance depletes the account exactly", () => {
  const result = run(FLAT, { direction: "outflow", amount: 10_000 });
  assert.equal(result.actualOutflows, 10_000);
  assert.equal(result.unpaidOutflows, 10_000);
  assert.equal(result.finalValue, 0);
  assert.equal(result.remainingUnits, 0);
  assert.equal(result.endingHoldingsValue, 0);
  assert.equal(result.endingCash, 0);
  assert.deepEqual(clean(result), []);
});

test("11. an inflow after depletion restarts investment from the new capital", () => {
  const result = simulateCashflows({
    dates: DATES.slice(0, 4),
    strategy: [100, 100, 100, 110],
    initialCapital: 10_000,
    cashflowEnabled: false,
    cashflowDirection: "inflow",
    manualEvents: [
      { index: 1, amount: 10_000, direction: "outflow" },
      { index: 2, amount: 5_000, direction: "inflow" },
    ],
  });
  assert.deepEqual(money(result.values), [10_000, 0, 5_000, 5_500]);
  // Only the rebuilt capital earns the next day's 10%.
  assert.ok(Math.abs(result.timeWeightedReturnPct - 10) < 1e-9);
  assert.equal(result.cashflowDirection, "mixed");
  assert.deepEqual(auditAccount(result, DATES.slice(0, 4)), []);
});

test("11b. a depleted account cannot create value without new capital", () => {
  const depleted = run([100, 100, 100, 110], { direction: "outflow", amount: 10_000 });
  assert.deepEqual(money(depleted.values), [10_000, 10_000, 0, 0]);
  assert.equal(depleted.finalValue, 0);
  // This four-observation window schedules one withdrawal only.
  assert.equal(depleted.actualOutflows, 10_000);
  assert.equal(depleted.unpaidOutflows, 0);
  assert.equal(depleted.endingHoldingsValue, 0);
  assert.deepEqual(auditAccount(depleted, DATES.slice(0, 4)), []);

  const rebuilt = run([100, 100, 100, 110], { direction: "inflow", amount: 5_000 });
  assert.deepEqual(money(rebuilt.values), [10_000, 10_000, 15_000, 16_500]);
  assert.deepEqual(auditAccount(rebuilt, DATES.slice(0, 4)), []);
});

test("12. strategy, SPY and SPMO receive one identical cashflow schedule", () => {
  const accounts = buildPortfolioAccounts(
    {
      dates: DATES,
      strategy: RISING,
      spy: [100, 101, 102, 103, 104, 105],
      spmo: [100, 99, 98, 97, 96, 95],
    },
    {
      initialCapital: 10_000,
      cashflowEnabled: true,
      contributionAmount: 750,
      contributionFrequency: "monthly",
      cashflowDirection: "outflow",
    },
  );
  const schedules = ["strategy", "spy", "spmo"].map((id) => (
    accounts[id].cashflowEvents.map((event) => [event.date, event.requestedAmount])
  ));
  assert.deepEqual(schedules[0], [["2020-02-03", 750], ["2020-03-02", 750]]);
  assert.deepEqual(schedules[0], schedules[1]);
  assert.deepEqual(schedules[1], schedules[2]);
  for (const id of ["strategy", "spy", "spmo"]) {
    assert.deepEqual(auditAccount(accounts[id], DATES), [], id);
  }
});

test("13. different investment NAVs produce different account balances", () => {
  const accounts = buildPortfolioAccounts(
    {
      dates: DATES,
      strategy: FLAT,
      spy: RISING,
      spmo: FALLING,
    },
    {
      initialCapital: 10_000,
      cashflowEnabled: true,
      contributionAmount: 1_000,
      contributionFrequency: "monthly",
      cashflowDirection: "inflow",
    },
  );
  assert.equal(accounts.strategy.finalValue, 12_000);
  assert.ok(Math.abs(accounts.spy.finalValue - 15_620) < 1e-6);
  assert.ok(accounts.spmo.finalValue < accounts.strategy.finalValue);
  assert.notDeepEqual(accounts.spy.values, accounts.spmo.values);
});

test("14. time-weighted return contains no artificial cashflow jumps", () => {
  const result = run(RISING, { amount: 5_000 });
  const expected = RISING.map((value) => (value / 100 - 1) * 100);
  result.returns.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-9, `${index}: ${value} != ${expected[index]}`);
  });
  // The balance chart, by contrast, jumps on every deposit.
  assert.ok(Math.abs((result.values[2] - result.values[1]) - 5_000) < 1e-6);
});

test("15. money-weighted return prices the actual cashflow timing", () => {
  const early = simulateCashflows({
    dates: ["2020-01-02", "2020-06-30", "2020-12-31"],
    strategy: [100, 110, 110],
    initialCapital: 10_000,
    contributionEnabled: false,
  });
  const late = simulateCashflows({
    dates: ["2020-01-02", "2020-06-30", "2020-12-31"],
    strategy: [100, 110, 110],
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 10_000,
    contributionFrequency: "quarterly",
    cashflowDirection: "inflow",
  });
  assert.ok(Math.abs(early.timeWeightedReturnPct - late.timeWeightedReturnPct) < 1e-9);
  assert.ok(late.moneyWeightedReturnPct < early.moneyWeightedReturnPct);
  assert.ok(early.moneyWeightedReturnPct > 9.9 && early.moneyWeightedReturnPct < 10.1);
});

test("16. investment drawdown uses the unitized NAV, not the balance", () => {
  const window = {
    dates: DATES,
    strategy: [100, 120, 84, 84, 84, 84],
    spy: [100, 120, 84, 84, 84, 84],
    spmo: [100, 120, 84, 84, 84, 84],
    startsAtBacktestOrigin: true,
  };
  const config = { initialCapital: 10_000, cashflowEnabled: false };
  const analysis = buildBacktestAnalysis(window, config);
  const investment = analyzeDrawdown(window.strategy, window.dates);
  assert.ok(Math.abs(investment.maxDrawdown + 30) < 1e-9);
  assert.equal(investment.peakDate, "2020-01-31");
  assert.equal(investment.troughDate, "2020-02-03");
  // Without flows the balance falls with the NAV.
  assert.ok(Math.abs(analysis.accountDrawdown.maxDrawdown + 30) < 1e-6);
});

test("17. account drawdown follows balances and includes executed withdrawals", () => {
  const window = {
    dates: DATES,
    strategy: [100, 120, 120, 120, 120, 120],
    spy: [100, 120, 120, 120, 120, 120],
    spmo: [100, 120, 120, 120, 120, 120],
    startsAtBacktestOrigin: true,
  };
  const analysis = buildBacktestAnalysis(window, {
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 2_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
  });
  // The investment only rose, so its drawdown is zero ...
  assert.equal(analyzeDrawdown(window.strategy, window.dates).maxDrawdown, 0);
  // ... while the balance fell by the withdrawal.
  assert.ok(analysis.accountDrawdown.maxDrawdown < 0);
  assert.deepEqual(auditAccount(analysis.strategy, DATES), []);
});

test("18. inflation-adjusted simulation scales flows once, in base-date dollars", () => {
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
  assert.deepEqual(auditAccount(result, dates), []);
});

test("19. a narrowed window slices the simulation instead of restarting it", () => {
  const result = run(RISING);
  const sliced = sliceAccountSeries(result, 3, 5);
  // The dollar view keeps the real balance three years in, not fresh capital.
  assert.deepEqual(money(sliced.values), [13_200, 14_200, 15_620]);
  // The percentage view is rebased to the first visible observation, and it is
  // still the unitized TWR: the NAV rose 121 -> 133.1 (+10%) even though the
  // balance grew more because deposits bought units along the way.
  assert.equal(sliced.returns[0], 0);
  assert.ok(Math.abs(sliced.returns.at(-1) - ((133.1 / 121 - 1) * 100)) < 1e-9);
});

test("20. annual and monthly summaries stay flow-neutral", () => {
  const dates = ["2020-01-02", "2020-06-30", "2020-12-31", "2021-03-31"];
  const strategy = [100, 110, 121, 133.1];
  const window = { dates, strategy, spy: strategy, spmo: strategy };
  const annual = calculatePeriodReturns({ ...window, frequency: "annual" });
  const monthly = calculatePeriodReturns({ ...window, frequency: "monthly" });
  assert.equal(annual.length, 2);
  assert.ok(Math.abs(annual[0].strategy - 21) < 1e-9);
  assert.ok(Math.abs(annual[1].strategy - 10) < 1e-9);
  // The same rows are returned by the analysis, so a table can never diverge.
  const analysis = buildBacktestAnalysis(window, { initialCapital: 10_000, cashflowEnabled: false });
  assert.deepEqual(analysis.annualRows, annual);
  assert.deepEqual(analysis.monthlyRows, monthly);
});

test("critical: 10,000 -> 12,000, withdraw 12,000 leaves exactly zero", () => {
  const dates = ["2020-01-02", "2020-02-03", "2020-03-02", "2020-04-01", "2020-05-01"];
  const result = simulateCashflows({
    dates,
    strategy: [100, 120, 120, 120, 120],
    initialCapital: 10_000,
    contributionEnabled: true,
    contributionAmount: 12_000,
    contributionFrequency: "monthly",
    cashflowDirection: "outflow",
    startsAtBacktestOrigin: true,
  });
  const [first] = result.cashflowEvents;
  assert.equal(first.date, "2020-02-03");
  assert.equal(first.actualAmount, 12_000);
  assert.equal(first.unpaidAmount, 0);
  assert.equal(first.endingBalance, 0);
  assert.equal(result.finalValue, 0);
  assert.deepEqual(money(result.values), [10_000, 0, 0, 0, 0]);
  assert.ok(result.values.every((value) => value >= 0));
  assert.ok(Math.abs(result.timeWeightedReturnPct - 20) < 1e-9);
  assert.equal(result.netProfitLoss, 2_000);
  assert.equal(result.maxBalanceDrawdownPct, -100);
  // XIRR of -10,000 then +12,000 after 32 days, hand-computed.
  const expected = ((12_000 / 10_000) ** (365 / 32) - 1) * 100;
  assert.ok(
    Math.abs(result.moneyWeightedReturnPct - expected) < Math.abs(expected) * 0.01,
    `${result.moneyWeightedReturnPct} vs ${expected}`,
  );
  assert.deepEqual(auditAccount(result, dates), []);
});

test("21. direction changes balances and investor return, never the TWR series", () => {
  const window = {
    dates: DATES,
    strategy: RISING,
    spy: [100, 101, 102, 103, 104, 105],
    spmo: [100, 99, 98, 97, 96, 95],
    startsAtBacktestOrigin: true,
  };
  const base = {
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
  };
  const off = buildBacktestAnalysis(window, { ...base, cashflowEnabled: false });
  const inflow = buildBacktestAnalysis(window, { ...base, cashflowDirection: "inflow" });
  const outflow = buildBacktestAnalysis(window, { ...base, cashflowDirection: "outflow" });

  // The percentage chart must be immune to the flow schedule: same line, same
  // end label, for inflow, outflow and no cashflows at all.
  for (const analysis of [inflow, outflow, off]) {
    analysis.strategy.returns.forEach((value, index) => {
      assert.ok(
        Math.abs(value - off.strategy.returns[index]) < 1e-9,
        `return ${index} moved with the flow direction: ${value}`,
      );
    });
  }
  assert.ok(Math.abs(inflow.strategy.timeWeightedReturnPct - outflow.strategy.timeWeightedReturnPct) < 1e-9);
  assert.ok(Math.abs(inflow.strategy.timeWeightedReturnPct - 33.1) < 1e-9);

  // The dollar view and the investor figures must move, in opposite directions.
  assert.ok(inflow.strategy.finalValue > off.strategy.finalValue);
  assert.ok(outflow.strategy.finalValue < off.strategy.finalValue);
  assert.notDeepEqual(inflow.strategy.values, outflow.strategy.values);
  assert.ok(inflow.strategy.moneyWeightedReturnPct !== outflow.strategy.moneyWeightedReturnPct);
  assert.ok(inflow.strategy.netProfitLoss !== outflow.strategy.netProfitLoss);

  // Slicing for a chart range keeps that separation intact.
  const inflowSlice = sliceAccountSeries(inflow.strategy, 2, 5);
  const outflowSlice = sliceAccountSeries(outflow.strategy, 2, 5);
  assert.notDeepEqual(inflowSlice.values, outflowSlice.values);
  assert.deepEqual(inflowSlice.returns, outflowSlice.returns);

  for (const analysis of [inflow, outflow, off]) {
    assert.deepEqual(auditAccount(analysis.strategy, DATES), []);
  }
});

test("22. return on capital is the chart's flow-aware percentage", () => {
  const window = {
    dates: DATES,
    strategy: RISING,
    spy: [100, 101, 102, 103, 104, 105],
    spmo: [100, 99, 98, 97, 96, 95],
    startsAtBacktestOrigin: true,
  };
  const base = {
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
  };
  const off = buildBacktestAnalysis(window, { ...base, cashflowEnabled: false });
  const inflow = buildBacktestAnalysis(window, { ...base, cashflowDirection: "inflow" });
  const outflow = buildBacktestAnalysis(window, { ...base, cashflowDirection: "outflow" });

  // Profit against everything committed so far. A deposit dilutes the ratio;
  // a withdrawal does not, because the profit has already been earned.
  assert.deepEqual(
    inflow.strategy.capitalReturns.map((value) => Number(value.toFixed(4))),
    [0, 10, 9.0909, 20, 18.3333, 30.1667],
  );
  assert.deepEqual(
    outflow.strategy.capitalReturns.map((value) => Number(value.toFixed(4))),
    [0, 10, 10, 20, 20, 30],
  );
  // With no external flows the two measures coincide exactly.
  assert.deepEqual(
    off.strategy.capitalReturns.map((value) => Number(value.toFixed(4))),
    [0, 10, 10, 21, 21, 33.1],
  );
  off.strategy.capitalReturns.forEach((value, index) => {
    assert.ok(Math.abs(value - off.strategy.returns[index]) < 1e-9);
  });
  assert.ok(Math.abs(inflow.strategy.endingCapitalReturnPct - 3_620 / 120) < 1e-9);
  assert.ok(Math.abs(outflow.strategy.endingCapitalReturnPct - 30) < 1e-9);

  // The percentage chart therefore moves with the flow schedule, while the TWR
  // series used by the summary and the drawdown stays put.
  assert.notDeepEqual(inflow.strategy.capitalReturns, outflow.strategy.capitalReturns);
  assert.deepEqual(inflow.strategy.returns, outflow.strategy.returns);

  // Slicing keeps the absolute level: a range only zooms the x-axis.
  const slice = sliceAccountSeries(inflow.strategy, 3, 5);
  assert.deepEqual(
    slice.capitalReturns.map((value) => Number(value.toFixed(4))),
    [20, 18.3333, 30.1667],
  );
});

test("23. a report built from an older backend payload derives the same series", () => {
  const dates = DATES.slice(0, 4);
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
        balances: [10_000, 10_000, 11_000, 11_000],
        holdings_values: [10_000, 10_000, 11_000, 11_000],
        cash_values: [0, 0, 0, 0],
        units: [100, 100, 110, 110],
        twr_values: [0, 0, 0, 0],
        // No capital_return / balance_drawdown: an older publication.
        events: [{
          date: dates[2],
          direction: "inflow",
          requested_amount: 1_000,
          actual_amount: 1_000,
          unpaid_amount: 0,
          balance_before: 10_000,
          balance_after: 11_000,
          units: 110,
          available_cash: 0,
        }],
        investor_flows: [],
      },
      spy: null,
      spmo: null,
    },
  };
  const window = {
    dates,
    strategy: [100, 100, 100, 100],
    spy: [100, 100, 100, 100],
    spmo: [100, 100, 100, 100],
    startsAtBacktestOrigin: true,
  };
  const analysis = buildBacktestAnalysis(
    window,
    { initialCapital: 10_000, cashflowEnabled: true, contributionAmount: 1_000, contributionFrequency: "monthly", cashflowDirection: "inflow" },
    backend,
  );
  // The deposit bought units at the same NAV, so the ratio dilutes to zero.
  assert.deepEqual(
    analysis.strategy.capitalReturns.map((value) => Number(value.toFixed(6))),
    [0, 0, 0, 0],
  );
  assert.equal(analysis.strategy.endingCapitalReturnPct, 0);
});

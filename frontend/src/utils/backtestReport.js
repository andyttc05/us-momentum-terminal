const FREQUENCIES = ["monthly", "quarterly", "annually"];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeBalance(value) {
  return finite(value) && value > 0 ? value : 0;
}

function maxNonNegative(value) {
  return finite(value) && value > 0 ? value : 0;
}

function quarterFor(date) {
  return Math.ceil(Number(date.slice(5, 7)) / 3);
}

export function periodKey(date, frequency) {
  if (frequency === "monthly") return date.slice(0, 7);
  if (frequency === "quarterly") return `${date.slice(0, 4)}-Q${quarterFor(date)}`;
  return date.slice(0, 4);
}

export function periodLabel(date, frequency) {
  const year = date.slice(0, 4);
  if (frequency === "annual") return year;
  if (frequency === "quarterly") return `${year} Q${quarterFor(date)}`;
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
  return `${month} ${year}`;
}

export function cashflowSchedule(dates, {
  enabled = false,
  amount = 0,
  frequency = "monthly",
} = {}) {
  if (!Array.isArray(dates) || !enabled || !finite(amount) || amount <= 0 || dates.length < 2) {
    return [];
  }
  const normalizedFrequency = FREQUENCIES.includes(frequency) ? frequency : "monthly";
  const events = [];
  for (let index = 1; index < dates.length; index += 1) {
    if (
      periodKey(dates[index], normalizedFrequency)
      !== periodKey(dates[index - 1], normalizedFrequency)
    ) {
      events.push({ index, date: dates[index], requestedAmount: amount });
    }
  }
  return events;
}

function normalizedFrequency(value) {
  return value === "annually" ? "annual" : value;
}

/**
 * Convert the Python account contract into the browser's cash-flow report
 * shape. When the submitted configuration and observation count do not match,
 * return null so the identical local engine remains the deterministic fallback.
 */
export function normalizeBackendCashflowAccounts(payload, config, dates) {
  const accounts = payload?.accounts;
  const backendConfig = payload?.config;
  if (!accounts || !backendConfig || !Array.isArray(dates)) return null;
  const expectedEnabled = Boolean(config?.cashflowEnabled);
  const expectedDirection = config?.cashflowDirection === "outflow" ? "outflow" : "inflow";
  const expectedFrequency = normalizedFrequency(config?.contributionFrequency ?? "monthly");
  if (
    Boolean(backendConfig.enabled) !== expectedEnabled
    || backendConfig.direction !== expectedDirection
    || backendConfig.frequency !== expectedFrequency
    || Math.abs(Number(backendConfig.initial_capital) - Number(config?.initialCapital)) > 1e-9
    || (
      expectedEnabled
      && Math.abs(Number(backendConfig.amount) - Number(config?.contributionAmount)) > 1e-9
    )
  ) {
    return null;
  }

  const normalize = (account) => {
    if (!account || !Array.isArray(account.balances) || account.balances.length !== dates.length) {
      return null;
    }
    const totalInflows = Number(account.total_inflows ?? 0);
    const actualOutflows = Number(account.actual_outflows ?? 0);
    return {
      finalValue: Number(account.final_value),
      initialCapital: Number(account.initial_capital),
      nominalInitialCapital: Number(account.initial_capital),
      totalInflows,
      totalCashInflows: totalInflows,
      totalContributions: totalInflows - actualOutflows,
      nominalTotalInflows: totalInflows,
      nominalTotalContributions: totalInflows - actualOutflows,
      requestedOutflows: Number(account.requested_outflows ?? 0),
      totalOutflows: Number(account.requested_outflows ?? 0),
      totalCashOutflows: Number(account.requested_outflows ?? 0),
      actualOutflows,
      unpaidOutflows: Number(account.unpaid_outflows ?? 0),
      totalUnpaidOutflows: Number(account.unpaid_outflows ?? 0),
      nominalRequestedOutflows: Number(account.requested_outflows ?? 0),
      nominalActualOutflows: actualOutflows,
      nominalUnpaidOutflows: Number(account.unpaid_outflows ?? 0),
      netCashflows: Number(account.net_cashflow ?? 0),
      netProfitLoss: Number(account.net_profit_loss),
      endingHoldingsValue: Number(account.ending_holdings_value),
      endingCash: Number(account.ending_cash),
      remainingUnits: Number(account.remaining_units),
      grossInvestedCapital: Number(account.gross_invested_capital),
      cashflowDirection: account.cashflow_direction,
      timeWeightedReturnPct: account.time_weighted_return_pct,
      moneyWeightedReturnPct: account.money_weighted_return_pct,
      cashflowEvents: (account.events ?? []).map((event) => ({
        date: event.date,
        direction: event.direction,
        requestedAmount: event.requested_amount,
        actualAmount: event.actual_amount,
        unpaidAmount: event.unpaid_amount,
        endingBalance: event.balance_after,
        balanceBefore: event.balance_before,
        endingHoldingsValue: Math.max(0, Number(event.balance_after) - Number(event.available_cash)),
        availableCash: event.available_cash,
        units: event.units,
      })),
      timeline: dates.map((date, index) => ({
        date,
        value: Number(account.balances[index]),
        holdingsValue: Number(account.holdings_values?.[index] ?? account.balances[index]),
        availableCash: Number(account.cash_values?.[index] ?? 0),
        units: Number(account.units?.[index] ?? 0),
      })),
      investorFlows: (account.investor_flows ?? []).map((flow) => ({
        date: flow.date,
        amount: Number(flow.amount),
      })),
      dailyReturns: (account.daily_returns ?? []).map(Number),
      twrValues: (account.twr_values ?? []).map(Number),
      values: account.balances.map(Number),
      returns: (account.twr_values ?? []).map(Number),
      inflationAdjusted: false,
    };
  };

  const strategy = normalize(accounts.strategy);
  if (!strategy) return null;
  return {
    strategy,
    spy: normalize(accounts.spy),
    spmo: normalize(accounts.spmo),
  };
}

function buildGroups(dates, frequency) {
  const groups = [];
  dates.forEach((date, index) => {
    const key = periodKey(date, frequency);
    const current = groups.at(-1);
    if (current?.key === key) {
      current.endIndex = index;
      current.endDate = date;
      return;
    }
    groups.push({ key, startIndex: index, endIndex: index, startDate: date, endDate: date });
  });
  return groups;
}

function periodReturn(values, group, previousGroup, firstPeriodOrigin = null) {
  if (!values?.length) return null;
  const baseIndex = previousGroup?.endIndex ?? group.startIndex;
  // The opening calendar period includes the initial entry transaction cost.
  // Measure it from the 100 starting capital, not the first post-cost NAV.
  const base = previousGroup || !finite(firstPeriodOrigin)
    ? values[baseIndex]
    : firstPeriodOrigin;
  const ending = values[group.endIndex];
  if (!finite(base) || !finite(ending) || base === 0) return null;
  return (ending / base - 1) * 100;
}

/**
 * Calculate period returns from actual portfolio/index values. Each period uses
 * the prior period's final observation as its base, never an average of daily
 * or monthly percentage changes.
 */
export function calculatePeriodReturns({
  dates,
  strategy,
  spy = [],
  spmo = [],
  frequency = "annual",
  startsAtBacktestOrigin = false,
}) {
  if (!Array.isArray(dates) || !Array.isArray(strategy) || dates.length !== strategy.length) return [];
  const groups = buildGroups(dates, frequency);
  const firstPeriodOrigin = startsAtBacktestOrigin ? 100 : null;
  return groups.map((group, index) => {
    const previousGroup = groups[index - 1] ?? null;
    const firstYear = dates[0]?.slice(0, 4);
    const lastYear = dates.at(-1)?.slice(0, 4);
    const row = {
      key: group.key,
      label: periodLabel(group.endDate, frequency),
      startDate: group.startDate,
      endDate: group.endDate,
      strategy: periodReturn(strategy, group, previousGroup, firstPeriodOrigin),
      spy: periodReturn(spy, group, previousGroup, firstPeriodOrigin),
      spmo: periodReturn(spmo, group, previousGroup, firstPeriodOrigin),
      partialStart: frequency === "annual"
        && group.endDate.slice(0, 4) === firstYear
        && dates[0]?.slice(5) > "01-07",
      ytd: frequency === "annual"
        && group.endDate.slice(0, 4) === lastYear
        && dates.at(-1)?.slice(5) < "12-25",
    };
    return row;
  });
}

/**
 * Simulate an investor account from the existing strategy daily NAV stream.
 * Cashflows are applied at the close of the first trading observation in each
 * new period, so the amount never receives that day's strategy return.
 * Time-weighted return remains independent of external cashflows.
 */
export function simulateCashflows({
  dates,
  strategy,
  initialCapital = 10_000,
  contributionEnabled = false,
  contributionAmount = 1_000,
  contributionFrequency = "monthly",
  cashflowDirection = "inflow",
  startsAtBacktestOrigin = false,
  purchasingPower = [],
}) {
  if (!Array.isArray(dates) || !Array.isArray(strategy) || dates.length < 2 || dates.length !== strategy.length) {
    return {
      finalValue: null,
      initialCapital: null,
      nominalInitialCapital: null,
      totalInflows: null,
      totalContributions: null,
      nominalTotalInflows: null,
      nominalTotalContributions: null,
      requestedOutflows: null,
      actualOutflows: null,
      unpaidOutflows: null,
      netCashflows: null,
      netProfitLoss: null,
      timeWeightedReturnPct: null,
      moneyWeightedReturnPct: null,
      endingHoldingsValue: null,
      endingCash: null,
      remainingUnits: null,
      grossInvestedCapital: null,
      dailyReturns: [],
      twrValues: [],
      cashflowEvents: [],
      timeline: [],
      investorFlows: [],
    };
  }
  const frequency = FREQUENCIES.includes(contributionFrequency) ? contributionFrequency : "monthly";
  const capital = finite(initialCapital) && initialCapital > 0 ? initialCapital : 10_000;
  const contribution = finite(contributionAmount) && contributionAmount > 0 ? contributionAmount : 0;
  const direction = cashflowDirection === "outflow" ? "outflow" : "inflow";
  const powerAt = (index) => (
    finite(purchasingPower[index]) && purchasingPower[index] > 0
      ? purchasingPower[index]
      : 1
  );
  const initialCapitalReal = capital * powerAt(0);
  const initialNav = strategy[0];
  const origin = startsAtBacktestOrigin ? 100 : strategy[0];
  let units = (
    finite(initialNav)
    && initialNav > 0
    && finite(origin)
    && origin > 0
  ) ? initialCapitalReal / origin : 0;
  let availableCash = 0;
  let value = nonNegativeBalance(units * initialNav);
  let totalInflows = 0;
  let nominalTotalInflows = 0;
  let requestedOutflows = 0;
  let nominalRequestedOutflows = 0;
  let actualOutflows = 0;
  let nominalActualOutflows = 0;
  let unpaidOutflows = 0;
  let nominalUnpaidOutflows = 0;
  const timeline = [{
    date: dates[0],
    value,
    holdingsValue: value,
    availableCash,
    units,
  }];
  const investorFlows = [{ date: dates[0], amount: -initialCapitalReal }];
  const cashflowEvents = [];
  const scheduled = cashflowSchedule(dates, {
    enabled: contributionEnabled,
    amount: contribution,
    frequency,
  });
  const scheduleByIndex = new Map(scheduled.map((event) => [event.index, event]));

  for (let index = 1; index < dates.length; index += 1) {
    const currentNav = strategy[index];
    // Units of the total-return wealth index stay constant through market
    // moves; the NAV already contains the investment return. Cash flows change
    // units at the close and therefore preserve the current allocation.
    if (!finite(currentNav) || currentNav <= 0) units = 0;
    // A contribution received while NAV is unavailable stays in cash and is
    // invested once a valid close exists. It never earns that day's return.
    if (availableCash > 0 && finite(currentNav) && currentNav > 0) {
      units += availableCash / currentNav;
      availableCash = 0;
    }
    let holdingsValue = finite(currentNav) && currentNav > 0
      ? maxNonNegative(units * currentNav)
      : 0;
    value = nonNegativeBalance(holdingsValue + availableCash);
    const scheduledEvent = scheduleByIndex.get(index);
    if (scheduledEvent) {
      const power = powerAt(index);
      const requestedReal = contribution * power;
      let actualReal = requestedReal;
      let unpaidReal = 0;
      const balanceBefore = value;

      if (direction === "outflow") {
        actualReal = Math.min(requestedReal, value);
        unpaidReal = Math.max(0, requestedReal - actualReal);
        const cashUsed = Math.min(availableCash, actualReal);
        availableCash -= cashUsed;
        const unitsSoldValue = actualReal - cashUsed;
        if (unitsSoldValue > 0 && finite(currentNav) && currentNav > 0) {
          units = Math.max(0, units - unitsSoldValue / currentNav);
        }
        holdingsValue = finite(currentNav) && currentNav > 0
          ? maxNonNegative(units * currentNav)
          : 0;
        value = nonNegativeBalance(holdingsValue + availableCash);
        if (value <= 1e-12) {
          value = 0;
          units = 0;
          availableCash = 0;
          holdingsValue = 0;
        }
        requestedOutflows += requestedReal;
        nominalRequestedOutflows += contribution;
        actualOutflows += actualReal;
        nominalActualOutflows += actualReal / power;
        unpaidOutflows += unpaidReal;
        nominalUnpaidOutflows += unpaidReal / power;
        investorFlows.push({ date: dates[index], amount: actualReal });
      } else {
        if (finite(currentNav) && currentNav > 0) {
          units += actualReal / currentNav;
          holdingsValue = maxNonNegative(units * currentNav);
        } else {
          availableCash += actualReal;
        }
        value = nonNegativeBalance(holdingsValue + availableCash);
        totalInflows += actualReal;
        nominalTotalInflows += contribution;
        investorFlows.push({ date: dates[index], amount: -actualReal });
      }

      cashflowEvents.push({
        date: dates[index],
        direction,
        requestedAmount: requestedReal,
        actualAmount: actualReal,
        unpaidAmount: unpaidReal,
        endingBalance: value,
        balanceBefore,
        endingHoldingsValue: holdingsValue,
        availableCash,
        units,
      });
    }
    holdingsValue = finite(currentNav) && currentNav > 0
      ? maxNonNegative(units * currentNav)
      : 0;
    value = nonNegativeBalance(holdingsValue + availableCash);
    timeline.push({
      date: dates[index],
      value,
      holdingsValue,
      availableCash,
      units,
    });
  }

  investorFlows.push({ date: dates.at(-1), amount: value });
  const endingNav = strategy.at(-1);
  const timeWeightedReturnPct = finite(origin) && origin > 0 && finite(endingNav) && endingNav >= 0
    ? (endingNav / origin - 1) * 100
    : null;
  const twrValues = strategy.map((navValue) => (
    finite(origin) && origin > 0 && finite(navValue) && navValue >= 0
      ? (navValue / origin - 1) * 100
      : null
  ));
  const dailyReturns = strategy.slice(1).map((navValue, index) => (
    finite(strategy[index]) && strategy[index] > 0 && finite(navValue) && navValue >= 0
      ? (navValue / strategy[index] - 1) * 100
      : null
  ));
  const endingHoldingsValue = timeline.at(-1).holdingsValue;
  const endingCash = timeline.at(-1).availableCash;

  return {
    finalValue: value,
    initialCapital: initialCapitalReal,
    nominalInitialCapital: capital,
    totalInflows,
    totalCashInflows: totalInflows,
    // Legacy name retained as the signed net of actual external cashflows.
    totalContributions: totalInflows - actualOutflows,
    nominalTotalInflows,
    nominalTotalContributions: nominalTotalInflows - nominalActualOutflows,
    requestedOutflows,
    totalOutflows: requestedOutflows,
    totalCashOutflows: requestedOutflows,
    actualOutflows,
    unpaidOutflows,
    totalUnpaidOutflows: unpaidOutflows,
    nominalRequestedOutflows,
    nominalActualOutflows,
    nominalUnpaidOutflows,
    netCashflows: totalInflows - actualOutflows,
    netProfitLoss: value + actualOutflows - initialCapitalReal - totalInflows,
    endingHoldingsValue,
    endingCash,
    remainingUnits: units,
    grossInvestedCapital: initialCapitalReal + totalInflows,
    cashflowDirection: direction,
    timeWeightedReturnPct,
    moneyWeightedReturnPct: calculateXirr(investorFlows),
    cashflowEvents,
    timeline,
    investorFlows,
    dailyReturns,
    twrValues,
    inflationAdjusted: purchasingPower.length > 0,
  };
}

/**
 * Build the exact dated account balances shown by the cumulative-return
 * tooltip. Every series uses the same opening capital, contribution schedule,
 * entry timing and purchasing-power basis; only its investment path differs.
 */
export function calculateCumulativeSeries(window, config = {}, backendAccounts = null) {
  if (!window || !Array.isArray(window.dates)) return {};
  const authoritative = normalizeBackendCashflowAccounts(
    backendAccounts,
    config,
    window.dates,
  );
  return Object.fromEntries(
    ["strategy", "spy", "spmo"].map((id) => {
      const investmentPath = window[id];
      if (
        !Array.isArray(investmentPath)
        || investmentPath.length !== window.dates.length
        || investmentPath.length < 2
      ) {
        return [id, { values: [], returns: [] }];
      }
      if (authoritative?.[id]) return [id, authoritative[id]];
      const account = simulateCashflows({
        dates: window.dates,
        strategy: investmentPath,
        initialCapital: config.initialCapital,
        contributionEnabled: config.cashflowEnabled,
        contributionAmount: config.contributionAmount,
        contributionFrequency: config.contributionFrequency,
        cashflowDirection: config.cashflowDirection,
        // The strategy NAV has already paid its initial entry cost. SPY and
        // SPMO start at their own first close with the same investor capital.
        startsAtBacktestOrigin: id === "strategy" && window.startsAtBacktestOrigin,
        purchasingPower: window.purchasingPower ?? [],
      });
      return [
        id,
        {
          ...account,
          values: account.timeline.map((point) => point.value),
          returns: account.twrValues,
        },
      ];
    }),
  );
}

/** Solve XIRR from dated investor cashflows using a bounded bisection search. */
export function calculateXirr(cashflows) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null;
  const grouped = new Map();
  cashflows.forEach(({ date, amount }) => {
    if (!date || !finite(amount)) return;
    grouped.set(date, (grouped.get(date) ?? 0) + amount);
  });
  const dated = [...grouped.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length < 2 || !dated.some((flow) => flow.amount < 0) || !dated.some((flow) => flow.amount > 0)) {
    return null;
  }

  const origin = new Date(`${dated[0].date}T00:00:00Z`);
  const npv = (rate) => dated.reduce((total, flow) => {
    const date = new Date(`${flow.date}T00:00:00Z`);
    const years = (date - origin) / 86_400_000 / 365;
    return total + flow.amount / ((1 + rate) ** years);
  }, 0);

  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low);
  let highValue = npv(high);
  let expansion = 0;
  while (Math.sign(lowValue) === Math.sign(highValue) && expansion < 8) {
    high *= 10;
    highValue = npv(high);
    expansion += 1;
  }
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (Math.abs(middleValue) < 1e-8) return middle * 100;
    if (Math.sign(middleValue) === Math.sign(lowValue)) {
      low = middle;
      lowValue = middleValue;
    } else {
      high = middle;
      highValue = middleValue;
    }
  }
  return ((low + high) / 2) * 100;
}

export function calculateBacktestReport(window, config, backendAccounts = null) {
  if (!window) return null;
  const authoritative = normalizeBackendCashflowAccounts(
    backendAccounts,
    config,
    window.dates,
  );
  const cashflow = authoritative?.strategy ?? simulateCashflows({
    dates: window.dates,
    strategy: window.strategy,
    initialCapital: config.initialCapital,
    contributionEnabled: config.cashflowEnabled,
    contributionAmount: config.contributionAmount,
    contributionFrequency: config.contributionFrequency,
    cashflowDirection: config.cashflowDirection,
    startsAtBacktestOrigin: window.startsAtBacktestOrigin,
    purchasingPower: window.purchasingPower ?? [],
  });
  const benchmarkReturn = window.spy?.length
    ? (window.spy.at(-1) / window.spy[0] - 1) * 100
    : null;

  return {
    ...cashflow,
    benchmarkReturnPct: benchmarkReturn,
    relativeToSpyPct: finite(benchmarkReturn)
      ? cashflow.timeWeightedReturnPct - benchmarkReturn
      : null,
    annualRows: calculatePeriodReturns({ ...window, frequency: "annual" }),
    quarterlyRows: calculatePeriodReturns({ ...window, frequency: "quarterly" }),
    monthlyRows: calculatePeriodReturns({ ...window, frequency: "monthly" }),
    inflation: window.inflation ?? null,
  };
}

function cpiAtDate(observations, date) {
  let low = 0;
  let high = observations.length - 1;
  let match = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const observation = observations[middle];
    if ((observation.available_from ?? observation.date) <= date) {
      match = observation;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

/**
 * Deflate every wealth-index series with the latest CPI-U observation that
 * was available on the portfolio date. Monetary purchasing-power factors are
 * returned alongside the repriced series for cashflow and XIRR accounting.
 */
export function applyInflationAdjustment(window, cpi) {
  const observations = Array.isArray(cpi?.observations) ? cpi.observations : [];
  if (!window?.dates?.length || !cpi?.available || !observations.length) {
    return {
      available: false,
      reason: cpi?.error || "No dated US CPI-U observations are available.",
    };
  }
  const aligned = window.dates.map((date) => cpiAtDate(observations, date));
  if (aligned.some((observation) => !observation) || !aligned[0]?.value) {
    return {
      available: false,
      reason: "CPI-U history does not cover the selected backtest window.",
    };
  }
  const baseCpi = aligned[0].value;
  const purchasingPower = aligned.map((observation) => baseCpi / observation.value);
  const deflated = (values) => (
    Array.isArray(values)
      ? values.map((value, index) => value * purchasingPower[index])
      : []
  );
  const strategy = deflated(window.strategy);
  let peak = strategy[0];
  const drawdown = strategy.map((value) => {
    peak = Math.max(peak, value);
    return peak ? (value / peak - 1) * 100 : null;
  });
  return {
    ...window,
    strategy,
    spy: deflated(window.spy),
    spmo: deflated(window.spmo),
    drawdown,
    purchasingPower,
    inflation: {
      available: true,
      baseObservation: aligned[0],
      latestObservation: aligned.at(-1),
      seriesId: cpi.series_id,
      source: cpi.source,
    },
  };
}

export function getBacktestAvailability({
  reinvestDividends,
  inflationAdjusted,
  block,
  cpi,
}) {
  if (
    !reinvestDividends
    && (
      !Array.isArray(block?.priceStrategy)
      || block.priceStrategy.length !== block?.strategy?.length
      || !Array.isArray(block?.priceSpy)
      || !Array.isArray(block?.priceSpmo)
    )
  ) {
    return {
      available: false,
      title: "Dividend-exclusive returns are unavailable",
      detail: "The publication does not include the split-adjusted price and cash-dividend series required for this mode.",
    };
  }
  if (
    !reinvestDividends
    && block?.dividendCoverage
    && block.dividendCoverage.incomplete_securities > 0
  ) {
    return {
      available: false,
      title: "Dividend coverage is incomplete",
      detail: `Missing corporate-action coverage for ${block.dividendCoverage.affected_tickers.join(", ")}.`,
    };
  }
  if (inflationAdjusted && (!cpi?.available || !cpi?.observations?.length)) {
    return {
      available: false,
      title: "Inflation adjustment is unavailable",
      detail: cpi?.error || "No dated US CPI-U series is included in the current publication.",
    };
  }
  return { available: true, title: "", detail: "" };
}

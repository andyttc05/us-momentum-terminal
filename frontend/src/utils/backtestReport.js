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

/**
 * Peak-to-date drawdown for any wealth series, in percent.
 *
 * The peak starts at zero rather than at the first observation so an account
 * that opens with capital cannot report a drawdown against a partial first
 * point. Used for account balances; the investment drawdown uses the same
 * definition applied to the unitized NAV.
 */
export function drawdownFromValues(values) {
  let peak = 0;
  return values.map((value) => {
    if (!finite(value)) return null;
    peak = Math.max(peak, value);
    return peak > 0 ? (value / peak - 1) * 100 : 0;
  });
}

/**
 * Describe a drawdown series: the maximum, and the dates it ran between.
 *
 * `peakDate` is the high-water mark, `troughDate` the lowest point after it,
 * and `recoveryDate` the first observation back at the peak (null when the
 * series never recovers inside the window).
 */
export function analyzeDrawdown(values, dates) {
  const series = drawdownFromValues(Array.isArray(values) ? values : []);
  const dated = Array.isArray(dates) ? dates : [];
  const result = {
    series,
    maxDrawdown: 0,
    peakIndex: null,
    peakDate: null,
    troughIndex: null,
    troughDate: null,
    recoveryIndex: null,
    recoveryDate: null,
  };
  if (!series.length) return result;

  let runningPeak = 0;
  let runningPeakIndex = 0;
  let deepest = 0;
  let deepestPeakIndex = 0;
  let deepestTroughIndex = null;
  series.forEach((value, index) => {
    if (!finite(value)) return;
    const level = values[index];
    if (finite(level) && level >= runningPeak) {
      runningPeak = level;
      runningPeakIndex = index;
    }
    if (value < deepest) {
      deepest = value;
      deepestPeakIndex = runningPeakIndex;
      deepestTroughIndex = index;
    }
  });
  result.maxDrawdown = deepest;
  if (deepestTroughIndex == null) return result;

  result.peakIndex = deepestPeakIndex;
  result.peakDate = dated[deepestPeakIndex] ?? null;
  result.troughIndex = deepestTroughIndex;
  result.troughDate = dated[deepestTroughIndex] ?? null;
  const peakLevel = values[deepestPeakIndex];
  for (let index = deepestTroughIndex + 1; index < values.length; index += 1) {
    if (finite(values[index]) && finite(peakLevel) && values[index] >= peakLevel) {
      result.recoveryIndex = index;
      result.recoveryDate = dated[index] ?? null;
      break;
    }
  }
  return result;
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
    const balances = account.balances.map(Number);
    const twrValues = (account.twr_values ?? []).map(Number);
    const balanceDrawdown = Array.isArray(account.balance_drawdown)
      && account.balance_drawdown.length === dates.length
      ? account.balance_drawdown.map(Number)
      : drawdownFromValues(balances);
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
      twrValues,
      capitalReturns: Array.isArray(account.capital_return)
        && account.capital_return.length === dates.length
        ? account.capital_return.map((value) => (value == null ? null : Number(value)))
        : null,
      endingCapitalReturnPct: Number.isFinite(Number(account.ending_capital_return_pct))
        ? Number(account.ending_capital_return_pct)
        : null,
      balanceDrawdown,
      maxBalanceDrawdownPct: balanceDrawdown.length ? Math.min(...balanceDrawdown) : null,
      values: balances,
      returns: twrValues,
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
  manualEvents = null,
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
      values: [],
      returns: [],
      capitalReturns: [],
      endingCapitalReturnPct: null,
      balanceDrawdown: [],
      maxBalanceDrawdownPct: null,
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
  // Seeded with the opening observation, which is recorded before the loop.
  const cumulativeInflows = [0];
  const cumulativeOutflows = [0];
  // Explicit dated events exist for diagnostics and for the accounting tests;
  // the scheduled path is the one the UI drives. Amounts on manual events are
  // already in base-date dollars, so they are never scaled again.
  const scheduled = Array.isArray(manualEvents) && manualEvents.length
    ? manualEvents
      .map((event) => {
        const index = Number(event?.index);
        const amount = Number(event?.amount);
        if (!Number.isInteger(index) || index <= 0 || index >= dates.length) return null;
        if (!finite(amount) || amount <= 0) return null;
        return {
          index,
          date: dates[index],
          requestedAmount: amount,
          direction: event?.direction === "outflow" ? "outflow" : "inflow",
          explicit: true,
        };
      })
      .filter(Boolean)
    : cashflowSchedule(dates, {
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
      const power = scheduledEvent.explicit ? 1 : powerAt(index);
      const requestedReal = scheduledEvent.requestedAmount * power;
      const eventDirection = scheduledEvent.direction ?? direction;
      let actualReal = requestedReal;
      let unpaidReal = 0;
      const balanceBefore = value;

      if (eventDirection === "outflow") {
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
        nominalRequestedOutflows += scheduledEvent.requestedAmount;
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
        nominalTotalInflows += scheduledEvent.requestedAmount;
        investorFlows.push({ date: dates[index], amount: -actualReal });
      }

      cashflowEvents.push({
        date: dates[index],
        direction: eventDirection,
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
    cumulativeInflows.push(totalInflows);
    cumulativeOutflows.push(actualOutflows);
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
  // The account balance drawdown follows the money the investor actually owns.
  // It therefore moves on an executed withdrawal, which the unitized-NAV
  // investment drawdown deliberately does not.
  const balanceDrawdown = drawdownFromValues(timeline.map((point) => point.value));
  // Return on capital: profit measured against every dollar the investor has
  // committed so far. It moves with each deposit and withdrawal, which is the
  // opposite of the unitized TWR and exactly why the chart offers both.
  const capitalReturns = timeline.map((point, index) => {
    const invested = initialCapitalReal + cumulativeInflows[index];
    const profit = point.value
      + cumulativeOutflows[index]
      - cumulativeInflows[index]
      - initialCapitalReal;
    return invested > 0 ? (profit / invested) * 100 : null;
  });

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
    cashflowDirection: new Set(scheduled.map((event) => event.direction ?? direction)).size > 1
      ? "mixed"
      : direction,
    timeWeightedReturnPct,
    moneyWeightedReturnPct: calculateXirr(investorFlows),
    cashflowEvents,
    timeline,
    investorFlows,
    dailyReturns,
    twrValues,
    values: timeline.map((point) => point.value),
    returns: twrValues,
    capitalReturns,
    endingCapitalReturnPct: capitalReturns.length ? capitalReturns.at(-1) : null,
    balanceDrawdown,
    maxBalanceDrawdownPct: balanceDrawdown.length ? Math.min(...balanceDrawdown) : null,
    inflationAdjusted: purchasingPower.length > 0,
  };
}

const PORTFOLIO_IDS = ["strategy", "spy", "spmo"];

/**
 * Rebuild the return-on-capital series from balances and dated flows.
 *
 * Used when a payload was published before the field existed; the formula is
 * identical to the one both simulators apply.
 */
function deriveCapitalReturns(account, values) {
  const initial = Number(account.initialCapital ?? 0);
  const timeline = Array.isArray(account.timeline) ? account.timeline : [];
  if (!values.length || !(initial > 0) || timeline.length !== values.length) return [];
  const flowsByDate = new Map();
  (account.cashflowEvents ?? []).forEach((event) => {
    const entry = flowsByDate.get(event.date) ?? { inflow: 0, outflow: 0 };
    if (event.direction === "outflow") entry.outflow += Number(event.actualAmount ?? 0);
    else entry.inflow += Number(event.actualAmount ?? 0);
    flowsByDate.set(event.date, entry);
  });
  let inflows = 0;
  let outflows = 0;
  return values.map((value, index) => {
    const flow = flowsByDate.get(timeline[index].date);
    if (flow) {
      inflows += flow.inflow;
      outflows += flow.outflow;
    }
    const invested = initial + inflows;
    if (!(invested > 0) || !finite(value)) return null;
    return ((value + outflows - inflows - initial) / invested) * 100;
  });
}

function withDerivedSeries(account) {
  const values = account.values?.length
    ? account.values
    : (account.timeline ?? []).map((point) => point.value);
  const returns = account.returns?.length ? account.returns : (account.twrValues ?? []);
  const balanceDrawdown = account.balanceDrawdown?.length
    ? account.balanceDrawdown
    : drawdownFromValues(values);
  const capitalReturns = account.capitalReturns?.length
    ? account.capitalReturns
    : deriveCapitalReturns(account, values);
  return {
    ...account,
    values,
    returns,
    capitalReturns,
    endingCapitalReturnPct: finite(account.endingCapitalReturnPct)
      ? account.endingCapitalReturnPct
      : capitalReturns.at(-1) ?? null,
    balanceDrawdown,
    maxBalanceDrawdownPct: balanceDrawdown.length ? Math.min(...balanceDrawdown) : null,
  };
}

/**
 * Single source of truth for the account simulation.
 *
 * Strategy, SPY and SPMO are simulated from the same requested external
 * cashflow schedule, the same opening capital and the same effective dates.
 * Only the investment NAV differs. When the Python service has already
 * published accounts for exactly this configuration they are reused verbatim;
 * the local engine only runs when there is no authoritative payload (for
 * example the inflation-adjusted view, which the service does not simulate).
 */
export function buildPortfolioAccounts(window, config = {}, backendAccounts = null) {
  if (!window || !Array.isArray(window.dates)) return {};
  const authoritative = normalizeBackendCashflowAccounts(
    backendAccounts,
    config,
    window.dates,
  );
  return Object.fromEntries(
    PORTFOLIO_IDS.map((id) => {
      const investmentPath = window[id];
      if (
        !Array.isArray(investmentPath)
        || investmentPath.length !== window.dates.length
        || investmentPath.length < 2
      ) {
        return [id, null];
      }
      if (authoritative?.[id]) return [id, withDerivedSeries(authoritative[id])];
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
      return [id, withDerivedSeries(account)];
    }),
  );
}

/**
 * Dated account balances for every portfolio. Kept for callers that only need
 * the chart series; it delegates to the same simulation as the report.
 */
export function calculateCumulativeSeries(window, config = {}, backendAccounts = null) {
  const accounts = buildPortfolioAccounts(window, config, backendAccounts);
  return Object.fromEntries(
    Object.entries(accounts).map(([id, account]) => [
      id,
      account ?? { values: [], returns: [] },
    ]),
  );
}

/**
 * Slice one simulated account to the visible chart window and rebase its
 * cumulative TWR to the first visible observation.
 *
 * A range filter changes what is visible, never how the account was run: the
 * balance series keeps the money the investor actually held, so a 1Y view of a
 * five-year account still shows the real balance instead of restarting the
 * simulation with fresh capital one year ago.
 */
export function sliceAccountSeries(account, startIndex, endIndex = null) {
  const values = account?.values;
  if (!Array.isArray(values) || !values.length) return { values: [], returns: [] };
  const from = Math.max(0, Math.min(Number(startIndex) || 0, values.length - 1));
  const to = Math.max(
    from,
    Math.min(endIndex == null ? values.length - 1 : Number(endIndex), values.length - 1),
  );
  const baseReturn = account.returns?.[from];
  const baseFactor = finite(baseReturn) ? 1 + baseReturn / 100 : null;
  const returns = (account.returns ?? []).slice(from, to + 1).map((value) => {
    if (!finite(value)) return null;
    if (!finite(baseFactor) || baseFactor <= 0) return value;
    return ((1 + value / 100) / baseFactor - 1) * 100;
  });
  return {
    values: values.slice(from, to + 1),
    returns,
    // Return on capital is an absolute measure since the account opened, so a
    // range only zooms the x-axis; it is never rebased.
    capitalReturns: Array.isArray(account.capitalReturns)
      ? account.capitalReturns.slice(from, to + 1)
      : [],
  };
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

/**
 * Build every backtesting result from one account simulation.
 *
 * The report, the KPI cards, the cumulative chart, the drawdown chart and the
 * exports all read this object, so a cashflow can never be applied on one path
 * and ignored on another.
 */
export function buildBacktestAnalysis(window, config = {}, backendAccounts = null) {
  if (!window?.dates?.length) return null;
  const accounts = buildPortfolioAccounts(window, config, backendAccounts);
  const strategy = accounts.strategy;
  if (!strategy) return null;
  const benchmarkReturn = window.spy?.length
    ? (window.spy.at(-1) / window.spy[0] - 1) * 100
    : null;

  return {
    // Flat account fields (`finalValue`, `netProfitLoss`, ...) so every card
    // reads the same numbers, plus the structured views below.
    ...strategy,
    accounts,
    strategy,
    // Account-balance drawdown: the money the investor actually holds. It
    // moves on an executed withdrawal, which the unitized-NAV investment
    // drawdown deliberately does not.
    accountDrawdown: analyzeDrawdown(strategy.values, window.dates),
    benchmarkReturnPct: benchmarkReturn,
    relativeToSpyPct: finite(benchmarkReturn) && finite(strategy.timeWeightedReturnPct)
      ? strategy.timeWeightedReturnPct - benchmarkReturn
      : null,
    annualRows: calculatePeriodReturns({ ...window, frequency: "annual" }),
    quarterlyRows: calculatePeriodReturns({ ...window, frequency: "quarterly" }),
    monthlyRows: calculatePeriodReturns({ ...window, frequency: "monthly" }),
    inflation: window.inflation ?? null,
  };
}

export function calculateBacktestReport(window, config, backendAccounts = null) {
  return buildBacktestAnalysis(window, config, backendAccounts);
}

const AUDIT_TOLERANCE = 1e-6;

function near(first, second) {
  return Math.abs(first - second) <= AUDIT_TOLERANCE;
}

/**
 * Verify the accounting identities every simulated account must satisfy.
 *
 * Returns a list of human-readable violations. Shared by the test suite so the
 * browser engine and the Python service are held to the same contract.
 */
export function auditAccount(account, dates = []) {
  const problems = [];
  if (!account) return ["account is missing"];
  const timeline = Array.isArray(account.timeline) ? account.timeline : [];
  const values = Array.isArray(account.values) && account.values.length
    ? account.values
    : timeline.map((point) => point.value);
  if (!values.length) return ["account has no balances"];
  if (timeline.length && timeline.length !== values.length) {
    problems.push(`timeline has ${timeline.length} points but ${values.length} balances`);
  }
  values.forEach((value, index) => {
    if (!finite(value)) problems.push(`balance[${index}] is not finite`);
    else if (value < -AUDIT_TOLERANCE) problems.push(`balance[${index}] is negative`);
  });
  timeline.forEach((point, index) => {
    const label = point.date ?? `#${index}`;
    if (!finite(point.value) || point.value < -AUDIT_TOLERANCE) {
      problems.push(`${label}: balance is missing or negative`);
    }
    if (!finite(point.holdingsValue) || point.holdingsValue < -AUDIT_TOLERANCE) {
      problems.push(`${label}: holdings value is missing or negative`);
    }
    if (!finite(point.availableCash) || point.availableCash < -AUDIT_TOLERANCE) {
      problems.push(`${label}: available cash is missing or negative`);
    }
    if (!finite(point.units) || point.units < -AUDIT_TOLERANCE) {
      problems.push(`${label}: units are missing or negative`);
    }
    if (finite(point.holdingsValue) && finite(point.availableCash) && finite(point.value)
      && !near(point.value, point.holdingsValue + point.availableCash)) {
      problems.push(`${label}: balance != holdings value + available cash`);
    }
  });

  const initialCapital = Number(account.initialCapital ?? 0);
  const totalInflows = Number(account.totalInflows ?? 0);
  const actualOutflows = Number(account.actualOutflows ?? 0);
  const endingBalance = values.at(-1);
  const grossInvested = initialCapital + totalInflows;
  if (finite(account.finalValue) && !near(account.finalValue, endingBalance)) {
    problems.push("finalValue does not equal the last balance");
  }
  if (finite(account.grossInvestedCapital) && !near(account.grossInvestedCapital, grossInvested)) {
    problems.push("grossInvestedCapital != initial capital + total inflows");
  }
  if (finite(account.netProfitLoss)
    && !near(account.netProfitLoss, endingBalance + actualOutflows - grossInvested)) {
    problems.push("netProfitLoss != ending balance + actual outflows - initial capital - inflows");
  }
  if (finite(account.unpaidOutflows) && account.unpaidOutflows < -AUDIT_TOLERANCE) {
    problems.push("unpaid outflows are negative");
  }

  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  (account.cashflowEvents ?? []).forEach((event) => {
    const label = event.date ?? "event";
    const requested = Number(event.requestedAmount ?? 0);
    const actual = Number(event.actualAmount ?? 0);
    const unpaid = Number(event.unpaidAmount ?? 0);
    const before = Number(event.balanceBefore ?? 0);
    const after = Number(event.endingBalance ?? 0);
    if (actual < -AUDIT_TOLERANCE) problems.push(`${label}: executed amount is negative`);
    if (unpaid < -AUDIT_TOLERANCE) problems.push(`${label}: unpaid amount is negative`);
    if (!near(actual + unpaid, requested)) problems.push(`${label}: actual + unpaid != requested`);
    if (event.direction === "outflow" && actual > before + AUDIT_TOLERANCE) {
      problems.push(`${label}: executed more than the available balance`);
    }
    const expectedAfter = event.direction === "outflow"
      ? Math.max(0, before - actual)
      : before + actual;
    if (!near(after, expectedAfter)) {
      problems.push(`${label}: ending balance != expected post-event balance`);
    }
    const index = dateIndex.get(label);
    if (index != null && finite(values[index]) && !near(values[index], after)) {
      problems.push(`${label}: event balance does not match the timeline`);
    }
    if (event.direction === "inflow" && unpaid > AUDIT_TOLERANCE) {
      problems.push(`${label}: an inflow cannot be unpaid`);
    }
  });

  ["timeWeightedReturnPct", "moneyWeightedReturnPct"].forEach((key) => {
    const value = account[key];
    if (value != null && !finite(value)) problems.push(`${key} is not finite`);
  });

  return problems;
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

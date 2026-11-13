const FREQUENCIES = ["monthly", "quarterly", "annually"];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
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

function periodReturn(values, group, previousGroup) {
  if (!values?.length) return null;
  const baseIndex = previousGroup?.endIndex ?? group.startIndex;
  const base = values[baseIndex];
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
}) {
  if (!Array.isArray(dates) || !Array.isArray(strategy) || dates.length !== strategy.length) return [];
  const groups = buildGroups(dates, frequency);
  return groups.map((group, index) => {
    const previousGroup = groups[index - 1] ?? null;
    const firstYear = dates[0]?.slice(0, 4);
    const lastYear = dates.at(-1)?.slice(0, 4);
    const row = {
      key: group.key,
      label: periodLabel(group.endDate, frequency),
      startDate: group.startDate,
      endDate: group.endDate,
      strategy: periodReturn(strategy, group, previousGroup),
      spy: periodReturn(spy, group, previousGroup),
      spmo: periodReturn(spmo, group, previousGroup),
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
 * Contributions are deposited at the close of the first trading observation in
 * each new period, so the contribution never receives that day's strategy
 * return. Time-weighted return remains independent of external cashflows.
 */
export function simulateCashflows({
  dates,
  strategy,
  initialCapital = 10_000,
  contributionEnabled = false,
  contributionAmount = 1_000,
  contributionFrequency = "monthly",
  startsAtBacktestOrigin = false,
  purchasingPower = [],
}) {
  if (!Array.isArray(dates) || !Array.isArray(strategy) || dates.length < 2 || dates.length !== strategy.length) {
    return {
      finalValue: null,
      initialCapital: null,
      totalContributions: null,
      timeWeightedReturnPct: null,
      moneyWeightedReturnPct: null,
      timeline: [],
    };
  }
  const frequency = FREQUENCIES.includes(contributionFrequency) ? contributionFrequency : "monthly";
  const capital = finite(initialCapital) && initialCapital > 0 ? initialCapital : 10_000;
  const contribution = finite(contributionAmount) && contributionAmount > 0 ? contributionAmount : 0;
  const powerAt = (index) => (
    finite(purchasingPower[index]) && purchasingPower[index] > 0
      ? purchasingPower[index]
      : 1
  );
  const costRatio = startsAtBacktestOrigin ? strategy[0] / 100 : 1;
  const initialCapitalReal = capital * powerAt(0);
  let value = initialCapitalReal * costRatio;
  let totalContributions = 0;
  let nominalTotalContributions = 0;
  const timeline = [{ date: dates[0], value }];
  const investorFlows = [{ date: dates[0], amount: -initialCapitalReal }];

  for (let index = 1; index < dates.length; index += 1) {
    value *= strategy[index] / strategy[index - 1];
    if (
      contributionEnabled
      && contribution > 0
      && periodKey(dates[index], frequency) !== periodKey(dates[index - 1], frequency)
    ) {
      const contributionReal = contribution * powerAt(index);
      value += contributionReal;
      totalContributions += contributionReal;
      nominalTotalContributions += contribution;
      investorFlows.push({ date: dates[index], amount: -contributionReal });
    }
    timeline.push({ date: dates[index], value });
  }

  investorFlows.push({ date: dates.at(-1), amount: value });
  const origin = startsAtBacktestOrigin ? 100 : strategy[0];
  const timeWeightedReturnPct = (strategy.at(-1) / origin - 1) * 100;

  return {
    finalValue: value,
    initialCapital: initialCapitalReal,
    nominalInitialCapital: capital,
    totalContributions,
    nominalTotalContributions,
    timeWeightedReturnPct,
    moneyWeightedReturnPct: calculateXirr(investorFlows),
    timeline,
    inflationAdjusted: purchasingPower.length > 0,
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

export function calculateBacktestReport(window, config) {
  if (!window) return null;
  const cashflow = simulateCashflows({
    dates: window.dates,
    strategy: window.strategy,
    initialCapital: config.initialCapital,
    contributionEnabled: config.cashflowEnabled,
    contributionAmount: config.contributionAmount,
    contributionFrequency: config.contributionFrequency,
    startsAtBacktestOrigin: window.startsAtBacktestOrigin,
    purchasingPower: window.purchasingPower ?? [],
  });
  const benchmarkReturn = window.spy?.length
    ? (window.spy.at(-1) / window.spy[0] - 1) * 100
    : null;

  return {
    ...cashflow,
    netProfitLoss: cashflow.finalValue - cashflow.initialCapital - cashflow.totalContributions,
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

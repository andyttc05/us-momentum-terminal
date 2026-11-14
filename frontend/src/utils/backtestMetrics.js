/**
 * Backtesting KPI metrics.
 *
 * The backend is the authority: `backtest.top100.metrics` already publishes the
 * cumulative return, CAGR, Sharpe ratio and maximum drawdown for the full
 * published window, computed from the same NAV series that is plotted.
 *
 * This module therefore *reuses* those values whenever the selected window is
 * exactly that published window. It only derives metrics when the user narrows
 * the window with the date pickers, because no backend metric exists for an
 * arbitrary sub-range. The derived path mirrors `data-service/app/backtest.py`
 * exactly (365-day CAGR basis, sample standard deviation, zero risk-free rate)
 * so a sub-range can never use a different convention from the published one.
 */

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function dailyReturns(values) {
  const returns = [];
  for (let index = 1; index < values.length; index += 1) {
    if (finite(values[index - 1]) && finite(values[index]) && values[index - 1] > 0) {
      returns.push(values[index] / values[index - 1] - 1);
    }
  }
  return returns;
}

function summaryStatistics(returns) {
  if (!returns.length) return { mean: null, variance: null, standardDeviation: null };
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance = returns.length > 1
    ? returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1)
    : null;
  return {
    mean,
    variance,
    standardDeviation: finite(variance) ? Math.sqrt(variance) : null,
  };
}

function calendarDays(dates) {
  const firstDate = new Date(`${dates[0]}T00:00:00Z`);
  const lastDate = new Date(`${dates.at(-1)}T00:00:00Z`);
  return Math.max((lastDate - firstDate) / 86_400_000, 1);
}

export function calculateSeriesStatistics(values, dates, origin = null) {
  if (
    !Array.isArray(values)
    || values.length < 2
    || !Array.isArray(dates)
    || dates.length !== values.length
  ) return null;
  const clean = values.filter(finite);
  if (clean.length !== values.length || clean.some((value) => value < 0)) return null;
  const base = finite(origin) && origin > 0 ? origin : values[0];
  const totalReturn = (values.at(-1) / base - 1) * 100;
  const cagr = 1 + totalReturn / 100 >= 0
    ? ((1 + totalReturn / 100) ** (365 / calendarDays(dates)) - 1) * 100
    : null;
  const returns = dailyReturns(values);
  const { mean, variance, standardDeviation } = summaryStatistics(returns);
  const downside = returns.map((value) => Math.min(value, 0));
  const downsideDeviation = downside.length
    ? Math.sqrt(downside.reduce((total, value) => total + value ** 2, 0) / downside.length)
    : 0;
  let peak = values[0];
  let maximumDrawdown = 0;
  values.forEach((value) => {
    peak = Math.max(peak, value);
    maximumDrawdown = Math.min(maximumDrawdown, (value / peak - 1) * 100);
  });
  return {
    totalReturn,
    cagr,
    annualizedVolatility: finite(standardDeviation) && standardDeviation > 0
      ? standardDeviation * Math.sqrt(252) * 100
      : null,
    maxDrawdown: maximumDrawdown,
    sharpe: returns.length >= 20 && finite(standardDeviation) && standardDeviation > 0
      ? (mean / standardDeviation) * Math.sqrt(252)
      : null,
    sortino: returns.length >= 20 && downsideDeviation > 0
      ? (mean / downsideDeviation) * Math.sqrt(252)
      : null,
  };
}

function benchmarkRelative(strategy, benchmark, strategyTotalReturn) {
  if (
    !Array.isArray(strategy)
    || !Array.isArray(benchmark)
    || strategy.length !== benchmark.length
    || strategy.length < 2
  ) {
    return null;
  }
  const strategyReturns = dailyReturns(strategy);
  const benchmarkReturns = dailyReturns(benchmark);
  if (strategyReturns.length !== benchmarkReturns.length || strategyReturns.length < 2) return null;
  const strategySummary = summaryStatistics(strategyReturns);
  const benchmarkSummary = summaryStatistics(benchmarkReturns);
  if (
    !finite(strategySummary.mean)
    || !finite(benchmarkSummary.mean)
    || !finite(strategySummary.variance)
    || !finite(benchmarkSummary.variance)
    || benchmarkSummary.variance <= 0
  ) {
    return {
      benchmarkTotalReturn: (benchmark.at(-1) / benchmark[0] - 1) * 100,
      excessReturn: null,
      beta: null,
      correlation: null,
      trackingError: null,
      informationRatio: null,
    };
  }
  const covariance = strategyReturns.reduce(
    (total, value, index) => (
      total + (value - strategySummary.mean) * (benchmarkReturns[index] - benchmarkSummary.mean)
    ),
    0,
  ) / (strategyReturns.length - 1);
  const activeReturns = strategyReturns.map((value, index) => value - benchmarkReturns[index]);
  const activeSummary = summaryStatistics(activeReturns);
  const trackingError = finite(activeSummary.standardDeviation) && activeSummary.standardDeviation > 0
    ? activeSummary.standardDeviation * Math.sqrt(252) * 100
    : null;
  const benchmarkTotalReturn = (benchmark.at(-1) / benchmark[0] - 1) * 100;
  return {
    benchmarkTotalReturn,
    excessReturn: finite(strategyTotalReturn) ? strategyTotalReturn - benchmarkTotalReturn : null,
    beta: covariance / benchmarkSummary.variance,
    correlation: covariance
      / Math.sqrt(strategySummary.variance * benchmarkSummary.variance),
    trackingError,
    informationRatio: finite(trackingError)
      ? (activeSummary.mean / Math.sqrt(activeSummary.variance)) * Math.sqrt(252)
      : null,
  };
}

/**
 * Format the actual elapsed calendar months between two effective backtest
 * observations. Partial calendar months are not rounded up because the label
 * reports completed duration, not the selected date-picker range.
 */
export function formatBacktestDuration(startDate, endDate) {
  const start = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate ?? "");
  const end = /^(\d{4})-(\d{2})-(\d{2})/.exec(endDate ?? "");
  if (!start || !end) return "—";

  const startYear = Number(start[1]);
  const startMonth = Number(start[2]);
  const startDay = Number(start[3]);
  const endYear = Number(end[1]);
  const endMonth = Number(end[2]);
  const endDay = Number(end[3]);
  let totalMonths = (endYear - startYear) * 12 + endMonth - startMonth;
  if (endDay < startDay) totalMonths -= 1;
  if (totalMonths < 0) return "—";
  if (totalMonths === 0) {
    return startDate === endDate ? "0m" : "<1m";
  }

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (!years) return `${months}m`;
  return months ? `${years}y ${months}m` : `${years}y`;
}

/**
 * @param {{ strategy: number[], dates: string[], drawdown: number[], fullWindow?: boolean } | null} window
 * @param {{ cumulative_return: number, cagr: number|null, max_drawdown: number, sharpe: number|null } | null} authoritative
 *        Published metrics for the full window. Ignored for a sub-range.
 */
export function computeWindowMetrics(window, authoritative = null) {
  if (!window) {
    return {
      totalReturn: null,
      cagr: null,
      annualizedVolatility: null,
      maxDrawdown: null,
      sharpe: null,
      sortino: null,
      benchmarks: { spy: null, spmo: null },
      benchmarkRelative: { spy: null, spmo: null },
      source: "none",
    };
  }

  if (window.fullWindow && authoritative) {
    const derived = calculateSeriesStatistics(
      window.strategy,
      window.dates,
      window.startsAtBacktestOrigin ? 100 : null,
    );
    const spy = calculateSeriesStatistics(window.spy, window.dates);
    const spmo = calculateSeriesStatistics(window.spmo, window.dates);
    const publishedRelative = authoritative.benchmark_relative ?? {};
    return {
      totalReturn: authoritative.cumulative_return ?? null,
      cagr: authoritative.cagr ?? null,
      annualizedVolatility: authoritative.annualized_volatility ?? derived.annualizedVolatility,
      maxDrawdown: authoritative.max_drawdown ?? null,
      sharpe: authoritative.sharpe ?? null,
      sortino: authoritative.sortino ?? derived.sortino,
      benchmarks: { spy, spmo },
      benchmarkRelative: {
        spy: publishedRelative.spy
          ? {
            benchmarkTotalReturn: publishedRelative.spy.benchmark_total_return ?? null,
            excessReturn: publishedRelative.spy.excess_return ?? null,
            beta: publishedRelative.spy.beta ?? null,
            correlation: publishedRelative.spy.correlation ?? null,
            trackingError: publishedRelative.spy.tracking_error ?? null,
            informationRatio: publishedRelative.spy.information_ratio ?? null,
          }
          : benchmarkRelative(window.strategy, window.spy, authoritative.cumulative_return),
        spmo: publishedRelative.spmo
          ? {
            benchmarkTotalReturn: publishedRelative.spmo.benchmark_total_return ?? null,
            excessReturn: publishedRelative.spmo.excess_return ?? null,
            beta: publishedRelative.spmo.beta ?? null,
            correlation: publishedRelative.spmo.correlation ?? null,
            trackingError: publishedRelative.spmo.tracking_error ?? null,
            informationRatio: publishedRelative.spmo.information_ratio ?? null,
          }
          : benchmarkRelative(window.strategy, window.spmo, authoritative.cumulative_return),
      },
      source: "backend",
    };
  }

  const values = window.strategy;
  // A window that begins at the backtest origin is measured from the starting
  // capital of 100, exactly like the published cumulative return; the first NAV
  // is 99.9 because the entry cost has already been paid. A narrower window is
  // measured from its own first observation. Both match `backtest.py`.
  const origin = window.startsAtBacktestOrigin ? 100 : values[0];
  const statistics = calculateSeriesStatistics(values, window.dates, origin);
  const spy = calculateSeriesStatistics(window.spy, window.dates);
  const spmo = calculateSeriesStatistics(window.spmo, window.dates);

  return {
    totalReturn: statistics.totalReturn,
    cagr: statistics.cagr,
    annualizedVolatility: statistics.annualizedVolatility,
    maxDrawdown: statistics.maxDrawdown,
    sharpe: statistics.sharpe,
    sortino: statistics.sortino,
    benchmarks: { spy, spmo },
    benchmarkRelative: {
      spy: benchmarkRelative(values, window.spy, statistics.totalReturn),
      spmo: benchmarkRelative(values, window.spmo, statistics.totalReturn),
    },
    source: "window",
  };
}

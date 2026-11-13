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
  if (!window) return { totalReturn: null, cagr: null, maxDrawdown: null, sharpe: null, source: "none" };

  if (window.fullWindow && authoritative) {
    return {
      totalReturn: authoritative.cumulative_return ?? null,
      cagr: authoritative.cagr ?? null,
      maxDrawdown: authoritative.max_drawdown ?? null,
      sharpe: authoritative.sharpe ?? null,
      source: "backend",
    };
  }

  const values = window.strategy;
  // A window that begins at the backtest origin is measured from the starting
  // capital of 100, exactly like the published cumulative return; the first NAV
  // is 99.9 because the entry cost has already been paid. A narrower window is
  // measured from its own first observation. Both match `backtest.py`.
  const origin = window.startsAtBacktestOrigin ? 100 : values[0];
  const totalReturn = (values.at(-1) / origin - 1) * 100;

  const firstDate = new Date(`${window.dates[0]}T00:00:00Z`);
  const lastDate = new Date(`${window.dates.at(-1)}T00:00:00Z`);
  const days = Math.max((lastDate - firstDate) / 86_400_000, 1);
  // Same 365-day basis as the Python service, so the two agree on a full window.
  const cagr = ((1 + totalReturn / 100) ** (365 / days) - 1) * 100;

  const returns = [];
  for (let index = 1; index < values.length; index += 1) {
    returns.push(values[index] / values[index - 1] - 1);
  }
  const mean = returns.reduce((total, value) => total + value, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : null;

  return {
    totalReturn,
    cagr,
    maxDrawdown: Math.min(...window.drawdown),
    sharpe,
    source: "window",
  };
}

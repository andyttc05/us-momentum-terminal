import { computeWindowMetrics } from "./backtestMetrics.js";
import { calculateCumulativeSeries, calculatePeriodReturns } from "./backtestReport.js";
import { csvRow, downloadCsvFile } from "./csv.js";
import { exportDateStamp, exportTimestamp, EXCEL_FORMAT } from "./exportFiles.js";
import { rebalanceLabel } from "./rebalanceFrequency.js";
import { universeLabel } from "./universeState.js";

const DAILY_PERFORMANCE_COLUMNS = [
  "Date",
  "Strategy Portfolio Value",
  "Strategy Daily Return (%)",
  "Strategy Cumulative Return (%)",
  "Strategy Drawdown (%)",
  "SPY Portfolio Value",
  "SPY Daily Return (%)",
  "SPY Cumulative Return (%)",
  "SPMO Portfolio Value",
  "SPMO Daily Return (%)",
  "SPMO Cumulative Return (%)",
];

const DRAWDOWN_COLUMNS = [
  "Date",
  "Strategy Drawdown (%)",
  "SPY Drawdown (%)",
  "SPMO Drawdown (%)",
];

const ACCOUNT_BALANCE_COLUMNS = [
  "Date",
  "Strategy Balance",
  "Strategy Holdings Value",
  "Strategy Available Cash",
  "Strategy Units",
  "SPY Balance",
  "SPY Holdings Value",
  "SPY Available Cash",
  "SPY Units",
  "SPMO Balance",
  "SPMO Holdings Value",
  "SPMO Available Cash",
  "SPMO Units",
];

const REBALANCING_COLUMNS = [
  "Rebalance Date",
  "Ticker",
  "Company",
  "Sector",
  "Portfolio Weight (%)",
  "Quantity / Shares",
];

const MONTHLY_RETURN_COLUMNS = [
  "Month",
  "Strategy Return (%)",
  "SPY Return (%)",
  "SPMO Return (%)",
];

const CASH_FLOW_COLUMNS = [
  "Scheduled Date",
  "Actual Cash Inflow",
  "Requested Cash Outflow",
  "Actual Cash Outflow",
  "Unpaid Cash Outflow",
  "Ending Portfolio Balance",
];

const PERFORMANCE_SUMMARY_COLUMNS = ["Metric", "Value", "Unit"];
const BENCHMARK_COMPARISON_COLUMNS = [
  "Benchmark",
  "Benchmark Return (%)",
  "Strategy Excess Return (pp)",
  "Beta",
  "Correlation",
  "Tracking Error (%)",
  "Information Ratio",
];
const SETTINGS_COLUMNS = ["Setting", "Value"];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function percentChange(values, index) {
  if (index <= 0 || !finite(values[index]) || !finite(values[index - 1]) || values[index - 1] === 0) {
    return null;
  }
  return (values[index] / values[index - 1] - 1) * 100;
}

function drawdown(values) {
  let peak = null;
  return values.map((value) => {
    if (!finite(value)) return null;
    peak = peak == null ? value : Math.max(peak, value);
    return peak ? (value / peak - 1) * 100 : null;
  });
}

function companySectorIndex(stocks = [], portfolios = {}) {
  const index = new Map();
  stocks.forEach((stock) => {
    if (!stock?.ticker) return;
    index.set(stock.ticker, {
      company: stock.company ?? null,
      sector: stock.sector ?? null,
    });
  });
  Object.values(portfolios).forEach((portfolio) => {
    (portfolio?.holdings ?? []).forEach((holding) => {
      const current = index.get(holding.ticker) ?? {};
      index.set(holding.ticker, {
        company: current.company ?? holding.company ?? null,
        sector: current.sector ?? holding.sector ?? null,
      });
    });
  });
  return index;
}

function buildCashFlowRows(account) {
  if (!account?.timeline?.length) return [];
  const opening = account.timeline[0];
  const rows = [[
    opening.date,
    account.initialCapital,
    null,
    null,
    null,
    opening.value,
  ]];

  account.cashflowEvents.forEach((event) => {
    const outflow = event.direction === "outflow";
    rows.push([
      event.date,
      outflow ? 0 : event.actualAmount,
      outflow ? event.requestedAmount : null,
      outflow ? event.actualAmount : null,
      outflow ? event.unpaidAmount : null,
      event.endingBalance,
    ]);
  });
  return rows;
}

function buildDailyRows(window, config, backendAccounts = null) {
  const account = calculateCumulativeSeries(window, config, backendAccounts);
  const strategyDrawdown = drawdown(window.strategy);
  const spyDrawdown = drawdown(window.spy);
  const spmoDrawdown = drawdown(window.spmo);
  const rows = window.dates.map((date, index) => [
    date,
    account.strategy?.values?.[index] ?? null,
    percentChange(window.strategy, index),
    account.strategy?.returns?.[index] ?? (window.strategy?.[index] - 100),
    strategyDrawdown[index],
    account.spy?.values?.[index] ?? null,
    percentChange(window.spy, index),
    account.spy?.returns?.[index] ?? (window.spy?.length ? window.spy[index] - 100 : null),
    account.spmo?.values?.[index] ?? null,
    percentChange(window.spmo, index),
    account.spmo?.returns?.[index] ?? (window.spmo?.length ? window.spmo[index] - 100 : null),
  ]);

  return {
    daily: rows,
    drawdowns: window.dates.map((date, index) => [
      date,
      strategyDrawdown[index],
      spyDrawdown[index],
      spmoDrawdown[index],
    ]),
    account,
  };
}

function buildRebalanceRows(block, stocks, portfolios) {
  const metadata = companySectorIndex(stocks, portfolios);
  const rows = [];
  (block?.rebalance_log ?? []).forEach((event) => {
    Object.entries(event.holdings ?? {}).forEach(([ticker, weight]) => {
      const details = metadata.get(ticker) ?? {};
      rows.push([
        event.execution_date,
        ticker,
        details.company ?? null,
        details.sector ?? null,
        finite(weight) ? weight : null,
        null,
      ]);
    });
  });
  return rows;
}

function buildMonthlyReturnRows(rows) {
  return rows.map((row) => [
    row.label,
    finite(row.strategy) ? row.strategy : null,
    finite(row.spy) ? row.spy : null,
    finite(row.spmo) ? row.spmo : null,
  ]);
}

function buildAccountBalanceRows(window, account) {
  return window.dates.map((date, index) => [
    date,
    account.strategy?.values?.[index] ?? null,
    account.strategy?.timeline?.[index]?.holdingsValue ?? null,
    account.strategy?.timeline?.[index]?.availableCash ?? null,
    account.strategy?.timeline?.[index]?.units ?? null,
    account.spy?.values?.[index] ?? null,
    account.spy?.timeline?.[index]?.holdingsValue ?? null,
    account.spy?.timeline?.[index]?.availableCash ?? null,
    account.spy?.timeline?.[index]?.units ?? null,
    account.spmo?.values?.[index] ?? null,
    account.spmo?.timeline?.[index]?.holdingsValue ?? null,
    account.spmo?.timeline?.[index]?.availableCash ?? null,
    account.spmo?.timeline?.[index]?.units ?? null,
  ]);
}

function buildPerformanceSummaryRows(metrics, account) {
  return [
    ["Initial Capital", account.initialCapital, "USD"],
    ["Final Portfolio Value", account.finalValue, "USD"],
    ["Total Return", metrics.totalReturn, "%"],
    ["CAGR", metrics.cagr, "%"],
    ["Annualized Volatility", metrics.annualizedVolatility, "%"],
    ["Maximum Drawdown", metrics.maxDrawdown, "%"],
    ["Sharpe Ratio (0% risk-free)", metrics.sharpe, "ratio"],
    ["Sortino Ratio (0% risk-free)", metrics.sortino, "ratio"],
    ["Time-Weighted Return", account.timeWeightedReturnPct, "%"],
    ["Money-Weighted Return / XIRR", account.moneyWeightedReturnPct, "%"],
    ["Total Cash Inflows", account.totalInflows, "USD"],
    ["Requested Cash Outflows", account.requestedOutflows, "USD"],
    ["Actual Cash Outflows", account.actualOutflows, "USD"],
    ["Unpaid Cash Outflows", account.unpaidOutflows, "USD"],
    ["Net Profit / Loss", account.netProfitLoss, "USD"],
  ];
}

function buildBenchmarkComparisonRows(metrics) {
  return ["spy", "spmo"].map((id) => {
    const relative = metrics.benchmarkRelative?.[id];
    return [
      id.toUpperCase(),
      relative?.benchmarkTotalReturn ?? null,
      relative?.excessReturn ?? null,
      relative?.beta ?? null,
      relative?.correlation ?? null,
      relative?.trackingError ?? null,
      relative?.informationRatio ?? null,
    ];
  });
}

function buildSettingsRows({ block, config, account, meta, exportedAt }) {
  const direction = config.cashflowDirection === "outflow" ? "outflow" : "inflow";
  const cashflow = config.cashflowEnabled
    ? `Enabled; $${Number(config.contributionAmount).toLocaleString("en-US")} ${config.contributionFrequency} ${direction}`
    : "Disabled";
  return [
    ["Start Date", config.startDate],
    ["End Date", config.endDate],
    ["Initial Capital", config.initialCapital],
    ["Universe Selection", universeLabel(config.portfolio)],
    ["Rebalancing Frequency", rebalanceLabel(config.rebalanceFrequency)],
    ["Cashflow Settings", cashflow],
    ["Cashflow Direction", config.cashflowEnabled ? (direction === "outflow" ? "Outflow" : "Inflow") : null],
    ["Contribution Amount", config.cashflowEnabled ? config.contributionAmount : null],
    ["Contribution Frequency", config.cashflowEnabled ? config.contributionFrequency : null],
    ["Reinvest Dividends", config.reinvestDividends ? "Yes" : "No"],
    ["Inflation Adjusted", config.inflationAdjusted ? "Yes" : "No"],
    ["Final Portfolio Value", account.finalValue],
    ["Total Cash Inflows", account.totalInflows],
    ["Requested Cash Outflows", account.requestedOutflows],
    ["Actual Cash Outflows", account.actualOutflows],
    ["Unpaid Cash Outflows", account.unpaidOutflows],
    ["Net Profit / Loss", account.netProfitLoss],
    ["Money-Weighted Return / XIRR (%)", account.moneyWeightedReturnPct],
    ["Time-Weighted Return (%)", account.timeWeightedReturnPct],
    ["Include YTD", config.includeYtd ? "Yes" : "No"],
    ["Data As Of", meta?.as_of ?? block?.end ?? null],
    ["Data Generated At", meta?.generated_at ?? null],
    ["Data Freshness", meta?.client_cache ? "Browser cache" : (meta?.cache_state ?? null)],
    ["Export Timestamp", exportedAt],
  ];
}

export function backtestFilename(config, extension, date = new Date()) {
  const startYear = String(config?.startDate ?? "").slice(0, 4) || "Start";
  const endYear = String(config?.endDate ?? "").slice(0, 4) || exportDateStamp(date).slice(0, 4);
  const universe = config?.portfolio === "top20" ? "Top20" : "Top100";
  return `US_Momentum_Backtest_${startYear}-${endYear}_${universe}.${extension}`;
}

export function buildBacktestExportData({
  window,
  block,
  config,
  stocks = [],
  portfolios = {},
  meta = null,
  exportedAt = exportTimestamp(),
}) {
  if (!window?.dates?.length || !window.strategy?.length) {
    throw new Error("No complete backtest window is available to export.");
  }
  const { daily, drawdowns, account } = buildDailyRows(
    window,
    config,
    config?.inflationAdjusted ? null : block?.cashflowAccounts,
  );
  const metrics = computeWindowMetrics(
    window,
    window.fullWindow
      && config?.reinvestDividends
      && !config?.inflationAdjusted
      ? block?.metrics ?? null
      : null,
  );
  const monthlyReturns = calculatePeriodReturns({
    ...window,
    frequency: "monthly",
  });
  const settings = buildSettingsRows({
    block,
    config,
    account: account.strategy,
    meta,
    exportedAt,
  });

  const dailyRows = [DAILY_PERFORMANCE_COLUMNS, ...daily];
  const workbookSheets = [
    {
      name: "Daily Performance",
      rows: dailyRows,
      widths: [12, 23, 22, 27, 22, 19, 18, 23, 20, 19, 24],
      formats: {
        1: EXCEL_FORMAT.currency,
        2: EXCEL_FORMAT.percent,
        3: EXCEL_FORMAT.percent,
        4: EXCEL_FORMAT.percent,
        5: EXCEL_FORMAT.currency,
        6: EXCEL_FORMAT.percent,
        7: EXCEL_FORMAT.percent,
        8: EXCEL_FORMAT.currency,
        9: EXCEL_FORMAT.percent,
        10: EXCEL_FORMAT.percent,
      },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Drawdown",
      rows: [DRAWDOWN_COLUMNS, ...drawdowns],
      widths: [12, 24, 18, 18],
      formats: { 1: EXCEL_FORMAT.percent, 2: EXCEL_FORMAT.percent, 3: EXCEL_FORMAT.percent },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Account Balances",
      rows: [ACCOUNT_BALANCE_COLUMNS, ...buildAccountBalanceRows(window, account)],
      widths: [12, 20, 24, 22, 16, 18, 22, 20, 14, 18, 22, 20, 14],
      formats: {
        1: EXCEL_FORMAT.currency,
        2: EXCEL_FORMAT.currency,
        3: EXCEL_FORMAT.currency,
        4: EXCEL_FORMAT.number,
        5: EXCEL_FORMAT.currency,
        6: EXCEL_FORMAT.currency,
        7: EXCEL_FORMAT.currency,
        8: EXCEL_FORMAT.number,
        9: EXCEL_FORMAT.currency,
        10: EXCEL_FORMAT.currency,
        11: EXCEL_FORMAT.currency,
        12: EXCEL_FORMAT.number,
      },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Monthly Returns",
      rows: [MONTHLY_RETURN_COLUMNS, ...buildMonthlyReturnRows(monthlyReturns)],
      widths: [16, 19, 15, 15],
      formats: { 1: EXCEL_FORMAT.percent, 2: EXCEL_FORMAT.percent, 3: EXCEL_FORMAT.percent },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Rebalancing History",
      rows: [REBALANCING_COLUMNS, ...buildRebalanceRows(block, stocks, portfolios)],
      widths: [17, 12, 32, 24, 22, 18],
      formats: { 4: EXCEL_FORMAT.weight, 5: EXCEL_FORMAT.number },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Cash Flows",
      rows: [CASH_FLOW_COLUMNS, ...buildCashFlowRows(account.strategy)],
      widths: [17, 19, 22, 20, 20, 25],
      formats: {
        1: EXCEL_FORMAT.currency,
        2: EXCEL_FORMAT.currency,
        3: EXCEL_FORMAT.currency,
        4: EXCEL_FORMAT.currency,
        5: EXCEL_FORMAT.currency,
      },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Performance Summary",
      rows: [PERFORMANCE_SUMMARY_COLUMNS, ...buildPerformanceSummaryRows(metrics, account.strategy)],
      widths: [34, 20, 12],
      freezeHeader: true,
    },
    {
      name: "Benchmark Comparison",
      rows: [BENCHMARK_COMPARISON_COLUMNS, ...buildBenchmarkComparisonRows(metrics)],
      widths: [14, 21, 27, 12, 14, 20, 19],
      formats: {
        1: EXCEL_FORMAT.percent,
        2: EXCEL_FORMAT.changePp,
        3: EXCEL_FORMAT.number,
        4: EXCEL_FORMAT.number,
        5: EXCEL_FORMAT.percent,
        6: EXCEL_FORMAT.number,
      },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Backtest Settings",
      rows: [SETTINGS_COLUMNS, ...settings],
      widths: [28, 64],
      formats: { 1: null },
      freezeHeader: true,
    },
  ];

  return {
    csv: dailyRows.map((row) => csvRow(row)).join("\r\n"),
    workbookSheets,
    rowCount: daily.length,
  };
}

export function downloadBacktestCsv(filename, csv) {
  downloadCsvFile(filename, csv);
}

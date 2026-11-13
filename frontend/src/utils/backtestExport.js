import { calculateCumulativeSeries, periodKey } from "./backtestReport.js";
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

const REBALANCING_COLUMNS = [
  "Rebalance Date",
  "Ticker",
  "Company",
  "Sector",
  "Portfolio Weight (%)",
  "Quantity / Shares",
];

const CASH_FLOW_COLUMNS = [
  "Date",
  "Cash Inflow",
  "Cash Outflow",
  "Contributions",
  "Dividends",
  "Fees",
  "Cash Balance",
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

function contributionDates(dates, config) {
  if (!config.cashflowEnabled || !finite(config.contributionAmount) || config.contributionAmount <= 0) {
    return [];
  }
  const matches = [];
  let previousPeriod = periodKey(dates[0], config.contributionFrequency);
  for (let index = 1; index < dates.length; index += 1) {
    const currentPeriod = periodKey(dates[index], config.contributionFrequency);
    if (currentPeriod !== previousPeriod) {
      matches.push({ index, amount: config.contributionAmount });
    }
    previousPeriod = currentPeriod;
  }
  return matches;
}

function buildCashFlowRows(window, config) {
  const contributionEvents = contributionDates(window.dates, config);
  const rowsByDate = new Map();
  const initialDate = window.dates[0];
  if (finite(config.initialCapital) && config.initialCapital > 0) {
    rowsByDate.set(initialDate, {
      date: initialDate,
      inflow: config.initialCapital,
      outflow: null,
      contributions: config.initialCapital,
      dividends: null,
      fees: null,
      balance: null,
    });
  }
  contributionEvents.forEach(({ index, amount }) => {
    const row = rowsByDate.get(window.dates[index]) ?? {
      date: window.dates[index],
      inflow: 0,
      outflow: null,
      contributions: 0,
      dividends: null,
      fees: null,
      balance: null,
    };
    row.inflow = (row.inflow ?? 0) + amount;
    row.contributions = (row.contributions ?? 0) + amount;
    rowsByDate.set(window.dates[index], row);
  });

  // The model does not publish a separate dividend-cash ledger, fee ledger or
  // end-of-day cash balance. Keep those cells blank instead of inventing them.
  return [...rowsByDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => [
      row.date,
      row.inflow,
      row.outflow,
      row.contributions,
      row.dividends,
      row.fees,
      row.balance,
    ]);
}

function buildDailyRows(window, config) {
  const account = calculateCumulativeSeries(window, config);
  const strategyDrawdown = drawdown(window.strategy);
  const spyDrawdown = drawdown(window.spy);
  const spmoDrawdown = drawdown(window.spmo);
  const rows = window.dates.map((date, index) => [
    date,
    account.strategy?.values?.[index] ?? null,
    percentChange(window.strategy, index),
    window.strategy?.[index] - 100,
    strategyDrawdown[index],
    account.spy?.values?.[index] ?? null,
    percentChange(window.spy, index),
    window.spy?.length ? window.spy[index] - 100 : null,
    account.spmo?.values?.[index] ?? null,
    percentChange(window.spmo, index),
    window.spmo?.length ? window.spmo[index] - 100 : null,
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

function buildSettingsRows({ block, config, meta, exportedAt }) {
  const cashflow = config.cashflowEnabled
    ? `Enabled; $${Number(config.contributionAmount).toLocaleString("en-US")} ${config.contributionFrequency}`
    : "Disabled";
  return [
    ["Start Date", config.startDate],
    ["End Date", config.endDate],
    ["Initial Capital", config.initialCapital],
    ["Universe Selection", universeLabel(config.portfolio)],
    ["Rebalancing Frequency", rebalanceLabel(config.rebalanceFrequency)],
    ["Cashflow Settings", cashflow],
    ["Contribution Amount", config.cashflowEnabled ? config.contributionAmount : null],
    ["Contribution Frequency", config.cashflowEnabled ? config.contributionFrequency : null],
    ["Reinvest Dividends", config.reinvestDividends ? "Yes" : "No"],
    ["Inflation Adjusted", config.inflationAdjusted ? "Yes" : "No"],
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
  const { daily, drawdowns } = buildDailyRows(window, config);
  const settings = buildSettingsRows({ block, config, meta, exportedAt });

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
      name: "Rebalancing History",
      rows: [REBALANCING_COLUMNS, ...buildRebalanceRows(block, stocks, portfolios)],
      widths: [17, 12, 32, 24, 22, 18],
      formats: { 4: EXCEL_FORMAT.weight, 5: EXCEL_FORMAT.number },
      autoFilter: true,
      freezeHeader: true,
    },
    {
      name: "Cash Flows",
      rows: [CASH_FLOW_COLUMNS, ...buildCashFlowRows(window, config)],
      widths: [15, 16, 16, 18, 16, 14, 16],
      formats: {
        1: EXCEL_FORMAT.currency,
        2: EXCEL_FORMAT.currency,
        3: EXCEL_FORMAT.currency,
        4: EXCEL_FORMAT.currency,
        5: EXCEL_FORMAT.currency,
        6: EXCEL_FORMAT.currency,
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

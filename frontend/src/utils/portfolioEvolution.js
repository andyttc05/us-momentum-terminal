import { csvRow } from "./csv.js";
import { EXCEL_FORMAT } from "./exportFiles.js";
import { rebalanceOption } from "./rebalanceFrequency.js";
import { universeLabel } from "./universeState.js";

export const HOLDINGS_STATUSES = Object.freeze([
  Object.freeze({ value: "all", label: "All" }),
  Object.freeze({ value: "new", label: "New" }),
  Object.freeze({ value: "retained", label: "Retained" }),
  Object.freeze({ value: "removed", label: "Removed" }),
]);

export const PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE = 10;
export const PORTFOLIO_EVOLUTION_EVENTS_PAGE_SIZE = 5;

const HOLDINGS_EXPORT_COLUMNS = [
  "Ticker",
  "Company",
  "Weight",
  "Weight Basis",
  "Status",
  "Signal Date",
  "Execution Date",
];

const EXECUTION_DATE_KEY = "execution_date";
const SIGNAL_DATE_KEY = "signal_date";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function dateValue(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  return match?.[1] ?? "";
}

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeType(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function isInitialType(value) {
  return value === "initial" || value === "initial_formation" || value === "initial_investment";
}

function holdingsEntries(rawHoldings) {
  if (Array.isArray(rawHoldings)) {
    return rawHoldings.flatMap((holding) => {
      if (Array.isArray(holding)) {
        const ticker = normalizeTicker(holding[0]);
        const weight = Number(holding[1]);
        return ticker && finite(weight) ? [{ ticker, weight }] : [];
      }
      if (!holding || typeof holding !== "object") return [];
      const ticker = normalizeTicker(
        holding.ticker ?? holding.symbol ?? holding.code,
      );
      const weight = Number(
        holding.weight
        ?? holding.target_weight
        ?? holding.targetWeight
        ?? holding.portfolio_weight
        ?? holding.portfolioWeight,
      );
      return ticker && finite(weight) ? [{ ticker, weight }] : [];
    });
  }
  if (!rawHoldings || typeof rawHoldings !== "object") return [];
  return Object.entries(rawHoldings).flatMap(([symbol, rawWeight]) => {
    const ticker = normalizeTicker(symbol);
    const weight = Number(rawWeight);
    return ticker && finite(weight) ? [{ ticker, weight }] : [];
  });
}

/**
 * Normalize the event history used by both published static data and direct
 * API simulations. Stored holdings order is retained because it is the only
 * deterministic sequence published with an event.
 */
export function normalizePortfolioEvents(block) {
  const source = Array.isArray(block?.rebalance_log) && block.rebalance_log.length
    ? block.rebalance_log
    : Array.isArray(block?.holdings_log)
      ? block.holdings_log
      : [];
  return source
    .map((raw, sourceIndex) => {
      if (!raw || typeof raw !== "object") return null;
      const executionDate = dateValue(
        raw[EXECUTION_DATE_KEY] ?? raw.executionDate ?? raw.rebalance_date ?? raw.rebalanceDate,
      );
      const signalDate = dateValue(
        raw[SIGNAL_DATE_KEY] ?? raw.signalDate ?? raw.selection_date ?? raw.selectionDate,
      );
      if (!executionDate) return null;
      const holdings = holdingsEntries(
        raw.holdings ?? raw.target_holdings ?? raw.targetHoldings,
      );
      if (!holdings.length) return null;
      const type = normalizeType(raw.type ?? raw.event_type ?? raw.eventType ?? raw.kind);
      const initial = isInitialType(type);
      const turnoverValue = raw.turnover_pct
        ?? raw.turnoverPct
        ?? raw.one_way_turnover_pct
        ?? raw.oneWayTurnoverPct;
      const turnoverNumber = Number(turnoverValue);
      return {
        id: `${executionDate}|${signalDate}|${type || "scheduled"}|${sourceIndex}`,
        sourceIndex,
        signalDate,
        executionDate,
        type: initial ? "initial_formation" : "scheduled",
        typeLabel: initial ? "Initial Formation" : "Scheduled",
        initial,
        count: holdings.length,
        holdings,
        turnoverPct: turnoverValue === null || turnoverValue === undefined || !finite(turnoverNumber)
          ? null
          : turnoverNumber,
        weightingMode: raw.weighting_mode ?? raw.weightingMode ?? null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.executionDate.localeCompare(left.executionDate)
      || right.signalDate.localeCompare(left.signalDate)
      || right.sourceIndex - left.sourceIndex
    ));
}

export function summarizePortfolioEvents(events = []) {
  const initialCount = events.filter((event) => event.initial).length;
  const scheduled = events.filter((event) => !event.initial);
  const scheduledTurnovers = scheduled
    .map((event) => event.turnoverPct)
    .filter(finite);
  return {
    totalEvents: events.length,
    initialCount,
    scheduledCount: scheduled.length,
    latestEvent: events[0] ?? null,
    averageScheduledTurnoverPct: scheduledTurnovers.length
      ? scheduledTurnovers.reduce((total, value) => total + value, 0) / scheduledTurnovers.length
      : null,
    scheduledTurnoverCount: scheduledTurnovers.length,
  };
}

export function comparePortfolioEvent(events, selectedEvent) {
  const current = selectedEvent
    ? events.find((event) => event.id === selectedEvent.id) ?? null
    : null;
  if (!current) {
    return {
      currentRows: [],
      removedRows: [],
      counts: { all: 0, new: 0, retained: 0, removed: 0 },
    };
  }
  const index = events.findIndex((event) => event.id === current.id);
  if (current.initial) {
    const currentRows = current.holdings.map((holding, rowIndex) => ({
      ...holding,
      rowIndex,
      status: "initial",
      statusLabel: "Initial",
      weightBasis: "Current Target Weight",
    }));
    return {
      currentRows,
      removedRows: [],
      counts: { all: currentRows.length, new: 0, retained: 0, removed: 0 },
    };
  }

  const previous = events[index + 1] ?? null;
  const previousTickers = new Set(
    (previous?.holdings ?? []).map((holding) => holding.ticker),
  );
  const currentTickers = new Set(current.holdings.map((holding) => holding.ticker));
  const currentRows = current.holdings.map((holding, rowIndex) => {
    const retained = previousTickers.has(holding.ticker);
    return {
      ...holding,
      rowIndex,
      status: retained ? "retained" : "new",
      statusLabel: retained ? "Retained" : "New",
      weightBasis: "Current Target Weight",
    };
  });
  const removedRows = (previous?.holdings ?? [])
    .filter((holding) => !currentTickers.has(holding.ticker))
    .map((holding, rowIndex) => ({
      ...holding,
      rowIndex,
      status: "removed",
      statusLabel: "Removed",
      weightBasis: "Previous Target Weight",
    }));
  return {
    currentRows,
    removedRows,
    counts: {
      all: currentRows.length,
      new: currentRows.filter((row) => row.status === "new").length,
      retained: currentRows.filter((row) => row.status === "retained").length,
      removed: removedRows.length,
    },
  };
}

export function companyIndex(stocks = [], portfolios = {}) {
  const index = new Map();
  const add = (ticker, company) => {
    const normalized = normalizeTicker(ticker);
    if (!normalized || !company) return;
    index.set(normalized, String(company).trim());
  };
  stocks.forEach((stock) => add(stock?.ticker, stock?.company));
  Object.values(portfolios ?? {}).forEach((portfolio) => {
    (portfolio?.holdings ?? []).forEach((holding) => add(holding?.ticker, holding?.company));
  });
  return index;
}

function normalizedSearch(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterPortfolioHoldings(rows, status = "all", query = "") {
  const selectedStatus = HOLDINGS_STATUSES.some(({ value }) => value === status)
    ? status
    : "all";
  const normalizedQuery = normalizedSearch(query);
  return rows
    .filter((row) => selectedStatus === "all" || row.status === selectedStatus)
    .filter((row) => {
      if (!normalizedQuery) return true;
      return (
        normalizedSearch(row.ticker).includes(normalizedQuery)
        || normalizedSearch(row.company).includes(normalizedQuery)
      );
    })
    .map((row, index) => ({ ...row, sequence: index + 1 }));
}

export function visiblePortfolioRows(comparison, status = "all", query = "") {
  const source = status === "removed"
    ? comparison?.removedRows ?? []
    : comparison?.currentRows ?? [];
  return filterPortfolioHoldings(source, status, query);
}

export function paginatePortfolioRows(rows, page, pageSize) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: currentPage,
    total,
    totalPages,
    rangeStart: total ? start + 1 : 0,
    rangeEnd: Math.min(start + pageSize, total),
  };
}

export function eventsForYear(events, year = "all") {
  if (year === "all") return events;
  return events.filter((event) => event.executionDate.startsWith(`${year}-`));
}

export function portfolioEventYears(events = []) {
  return [...new Set(events.map((event) => event.executionDate.slice(0, 4)).filter(Boolean))]
    .sort((left, right) => right.localeCompare(left));
}

export function resolveEventSelection(events, year, currentId) {
  const candidates = eventsForYear(events, year);
  return candidates.find((event) => event.id === currentId) ?? candidates[0] ?? null;
}

export function formatPortfolioDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ""));
  if (!match) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`));
}

export function formatTurnover(value) {
  if (!finite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function weightingMethod(block, selectedEvent) {
  const mode = selectedEvent?.weightingMode ?? block?.methodology?.weighting_mode;
  if (mode === "equal-weight-proxy") return "Equal-weight research proxy";
  if (mode) return String(mode).replaceAll("-", " ");
  return "Not published";
}

export function portfolioEvolutionFilename(config, selectedEvent, extension) {
  const universe = String(config?.portfolio ?? "top100").toLowerCase() === "top20"
    ? "Top20"
    : "Top100";
  const frequency = rebalanceOption(config?.rebalanceFrequency).summary.replaceAll(" ", "");
  return `US_Momentum_Holdings_${universe}_${frequency}_${selectedEvent?.executionDate ?? "Unavailable"}.${extension}`;
}

export function buildPortfolioEvolutionExportData({
  block,
  config,
  selectedEvent,
  rows = [],
}) {
  if (!selectedEvent) {
    throw new Error("Select a rebalance event before exporting holdings.");
  }
  const exportRows = rows.map((row) => [
    row.ticker,
    row.company,
    row.weight,
    row.weightBasis,
    row.statusLabel,
    selectedEvent.signalDate,
    selectedEvent.executionDate,
  ]);
  const detailRows = [
    ["Field", "Value"],
    ["Signal Date", selectedEvent.signalDate],
    ["Execution Date", selectedEvent.executionDate],
    ["Event Type", selectedEvent.typeLabel],
    ["Rebalancing Frequency", rebalanceOption(config?.rebalanceFrequency).summary],
    ["Universe Selection", universeLabel(config?.portfolio)],
    ["Holdings Count", selectedEvent.count],
    ["One-way Turnover", formatTurnover(selectedEvent.turnoverPct)],
    ["Weighting Method", weightingMethod(block, selectedEvent)],
  ];
  return {
    csv: [HOLDINGS_EXPORT_COLUMNS, ...exportRows]
      .map((row) => csvRow(row))
      .join("\r\n"),
    rowCount: exportRows.length,
    workbookSheets: [
      {
        name: "Historical Holdings",
        rows: [HOLDINGS_EXPORT_COLUMNS, ...exportRows],
        widths: [12, 36, 14, 25, 14, 14, 15],
        formats: { 2: EXCEL_FORMAT.weight },
        autoFilter: true,
        freezeHeader: true,
      },
      {
        name: "Rebalance Details",
        rows: detailRows,
        widths: [28, 54],
        freezeHeader: true,
      },
    ],
  };
}

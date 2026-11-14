import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarBlank,
  CaretRight,
  CaretUpDown,
  ClockCounterClockwise,
  MagnifyingGlass,
  Stack,
  TrendUp,
} from "@phosphor-icons/react";
import {
  DataState,
  Skeleton,
  TableSkeletonRows,
  TableStateRow,
} from "./DataState.jsx";
import { Dropdown } from "./SettingsControls.jsx";
import { ExportMenu } from "./ExportMenu.jsx";
import { KpiCard } from "./KpiCard.jsx";
import { Pagination } from "./Pagination.jsx";
import { downloadCsvFile } from "../utils/csv.js";
import { downloadWorkbookFile } from "../utils/exportFiles.js";
import { stockPath } from "../router.jsx";
import {
  shouldOpenRow,
  shouldRouteTickerClick,
  stockLinkLabel,
} from "../utils/rowNavigation.js";
import {
  DEFAULT_HOLDINGS_SORT,
  HOLDINGS_SORT_FIELDS,
  HOLDINGS_STATUSES,
  PORTFOLIO_EVOLUTION_EVENTS_PAGE_SIZE,
  PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE,
  buildPortfolioEvolutionExportData,
  companyIndex,
  comparePortfolioEvent,
  eventsForYear,
  formatPortfolioDate,
  formatHistoricalPortfolioWeight,
  formatTurnover,
  formatWeightChange,
  historicalPortfolioWeightAvailable,
  normalizePortfolioEvents,
  paginatePortfolioRows,
  portfolioEventYears,
  portfolioEvolutionFilename,
  resolveEventSelection,
  sortPortfolioRows,
  summarizePortfolioEvents,
  visiblePortfolioRows,
  weightChangeTone,
} from "../utils/portfolioEvolution.js";

const HOLDINGS_COLUMNS = 6;

function SortIcon({ active, direction }) {
  if (!active) return <CaretUpDown size={14} weight="bold" aria-hidden="true" />;
  return direction === "asc"
    ? <ArrowUp size={14} weight="bold" aria-hidden="true" />
    : <ArrowDown size={14} weight="bold" aria-hidden="true" />;
}

function HistoryEvent({
  event,
  selected,
  onSelect,
}) {
  return (
    <button
      type="button"
      className={`portfolio-evolution__event${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(event)}
    >
      <span className="portfolio-evolution__event-date">
        <strong>{formatPortfolioDate(event.executionDate)}</strong>
        <small>Signal: {formatPortfolioDate(event.signalDate)}</small>
      </span>
      <span className="portfolio-evolution__event-meta">
        <span className={`portfolio-evolution__event-type is-${event.initial ? "initial" : "scheduled"}`}>
          {event.typeLabel}
        </span>
        <span className="portfolio-evolution__event-turnover">
          <small>Turnover</small>
          <strong>{formatTurnover(event.turnoverPct)}</strong>
        </span>
      </span>
      <CaretRight size={19} weight="bold" aria-hidden="true" />
    </button>
  );
}

export function PortfolioEvolution({
  block,
  config,
  stocks = [],
  portfolios = {},
  state = "ready",
  onSelectStock,
  onNotify,
}) {
  const events = useMemo(() => normalizePortfolioEvents(block), [block]);
  const summary = useMemo(() => summarizePortfolioEvents(events), [events]);
  const years = useMemo(() => portfolioEventYears(events), [events]);
  const companyByTicker = useMemo(
    () => companyIndex(stocks, portfolios),
    [portfolios, stocks],
  );
  const [year, setYear] = useState("all");
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [holdingsPage, setHoldingsPage] = useState(1);
  const [sort, setSort] = useState({ ...DEFAULT_HOLDINGS_SORT });
  const [exporting, setExporting] = useState(false);

  const selectedEvent = useMemo(
    () => resolveEventSelection(events, year, selectedEventId),
    [events, selectedEventId, year],
  );
  const comparison = useMemo(
    () => comparePortfolioEvent(events, selectedEvent),
    [events, selectedEvent],
  );
  const currentRows = useMemo(
    () => comparison.currentRows.map((row) => ({
      ...row,
      company: companyByTicker.get(row.ticker) ?? row.company ?? "—",
    })),
    [companyByTicker, comparison.currentRows],
  );
  const removedRows = useMemo(
    () => comparison.removedRows.map((row) => ({
      ...row,
      company: companyByTicker.get(row.ticker) ?? row.company ?? "—",
    })),
    [companyByTicker, comparison.removedRows],
  );
  const comparable = useMemo(
    () => ({ ...comparison, currentRows, removedRows }),
    [comparison, currentRows, removedRows],
  );
  const filteredRows = useMemo(
    () => visiblePortfolioRows(comparable, status, query),
    [comparable, query, status],
  );
  const orderedRows = useMemo(
    () => sortPortfolioRows(filteredRows, sort),
    [filteredRows, sort],
  );
  const visibleYears = useMemo(() => eventsForYear(events, year), [events, year]);
  const history = useMemo(
    () => paginatePortfolioRows(
      visibleYears,
      historyPage,
      PORTFOLIO_EVOLUTION_EVENTS_PAGE_SIZE,
    ),
    [historyPage, visibleYears],
  );
  const holdings = useMemo(
    () => paginatePortfolioRows(
      orderedRows,
      holdingsPage,
      PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE,
    ),
    [holdingsPage, orderedRows],
  );

  useEffect(() => {
    const latest = events[0] ?? null;
    setYear("all");
    setSelectedEventId(latest?.id ?? null);
    setHistoryPage(1);
    setStatus("all");
    setQuery("");
    setHoldingsPage(1);
  }, [events]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, history.totalPages));
  }, [history.totalPages]);

  useEffect(() => {
    setHoldingsPage((current) => Math.min(current, holdings.totalPages));
  }, [holdings.totalPages]);

  function chooseYear(nextYear) {
    const nextSelection = resolveEventSelection(events, nextYear, selectedEvent?.id);
    setYear(nextYear);
    setSelectedEventId(nextSelection?.id ?? null);
    setHistoryPage(1);
    setStatus("all");
    setQuery("");
    setHoldingsPage(1);
  }

  function chooseEvent(event) {
    setSelectedEventId(event.id);
    setStatus("all");
    setQuery("");
    setHoldingsPage(1);
  }

  function chooseStatus(nextStatus) {
    setStatus(nextStatus);
    setHoldingsPage(1);
  }

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
    setHoldingsPage(1);
  }

  function updateSearch(nextQuery) {
    setQuery(nextQuery);
    setHoldingsPage(1);
  }

  async function exportHoldings(format) {
    if (!selectedEvent || !orderedRows.length || exporting) return;
    setExporting(true);
    try {
      const exportData = buildPortfolioEvolutionExportData({
        block,
        config,
        selectedEvent,
        rows: orderedRows,
      });
      const filename = portfolioEvolutionFilename(config, selectedEvent, format);
      if (format === "csv") {
        downloadCsvFile(filename, exportData.csv);
      } else {
        await downloadWorkbookFile(filename, exportData.workbookSheets);
      }
      onNotify?.({
        kind: "updated",
        message: `Exported ${exportData.rowCount} holdings`,
        id: "portfolio-evolution-export-complete",
      });
    } catch (error) {
      onNotify?.({
        kind: "error",
        message: error?.message || "Holdings export failed",
        id: "portfolio-evolution-export-error",
        durationMs: 5200,
      });
    } finally {
      setExporting(false);
    }
  }

  const loading = state === "loading";
  const unavailable = state === "error" || state === "empty" || !events.length;
  const tableEmpty = !loading && !filteredRows.length;
  const latestDate = summary.latestEvent
    ? formatPortfolioDate(summary.latestEvent.executionDate)
    : "—";

  return (
    <section
      className="portfolio-evolution"
      aria-label="Portfolio Evolution"
      data-state={state}
      aria-busy={loading || undefined}
    >
        <div className="portfolio-evolution__kpis">
          <KpiCard
            label="Total Events"
            value={loading ? "—" : String(summary.totalEvents)}
            detail={loading ? undefined : `${summary.initialCount} initial · ${summary.scheduledCount} scheduled`}
            icon={CalendarBlank}
            tint="cream"
            mascotVariant="blue"
            mascotColor="var(--color-blue)"
            loading={loading && !events.length}
          />
          <KpiCard
            label="Avg. One-way Turnover"
            value={loading ? "—" : formatTurnover(summary.averageScheduledTurnoverPct)}
            detail={loading ? undefined : "Scheduled events"}
            icon={TrendUp}
            tint="blue"
            mascotVariant="mint"
            mascotColor="var(--color-mint)"
            loading={loading && !events.length}
          />
          <KpiCard
            label="Latest Execution"
            value={loading ? "—" : latestDate}
            detail={loading
              ? undefined
              : summary.latestEvent
                ? `Signal: ${formatPortfolioDate(summary.latestEvent.signalDate)}`
                : "No execution recorded"}
            icon={CalendarBlank}
            tint="lavender"
            mascotVariant="pink"
            mascotColor="var(--color-pink)"
            loading={loading && !events.length}
          />
        </div>

        <div className="portfolio-evolution__workspace">
          <section
            className="portfolio-evolution__panel portfolio-evolution__history-panel"
            aria-labelledby="portfolio-evolution-history-title"
          >
            <header className="portfolio-evolution__panel-header">
              <div>
                <h3 id="portfolio-evolution-history-title">
                  <ClockCounterClockwise size={22} weight="regular" aria-hidden="true" />
                  Rebalancing History
                </h3>
              </div>
              <Dropdown
                id="portfolio-evolution-year"
                className="portfolio-evolution__year"
                value={year}
                onChange={(event) => chooseYear(event.target.value)}
                ariaLabel="Filter rebalance events by year"
                disabled={!events.length}
                options={[
                  { value: "all", label: "All Years" },
                  ...years.map((item) => ({ value: item, label: item })),
                ]}
              />
            </header>

            <div className="portfolio-evolution__events" aria-live="polite">
              {loading ? (
                <div className="portfolio-evolution__event-skeletons" aria-hidden="true">
                  {Array.from({ length: PORTFOLIO_EVOLUTION_EVENTS_PAGE_SIZE }, (_, index) => (
                    <div className="portfolio-evolution__event-skeleton" key={index}>
                      <Skeleton width="45%" height="17px" />
                      <Skeleton width="66%" height="11px" />
                    </div>
                  ))}
                </div>
              ) : history.rows.length ? history.rows.map((event) => (
                <HistoryEvent
                  key={event.id}
                  event={event}
                  selected={event.id === selectedEvent?.id}
                  onSelect={chooseEvent}
                />
              )) : (
                <DataState
                  state={unavailable ? "empty" : "ready"}
                  title="No rebalance events"
                  detail={block?.reason || "No valid event history was published for this result."}
                  className="portfolio-evolution__history-state"
                />
              )}
            </div>

            {!loading && history.total > 0 && (
              <Pagination
                page={history.page}
                totalPages={history.totalPages}
                rangeStart={history.rangeStart}
                rangeEnd={history.rangeEnd}
                total={history.total}
                onPageChange={setHistoryPage}
                label="Rebalancing history pagination"
              />
            )}
          </section>

          <section
            className="portfolio-evolution__panel portfolio-evolution__holdings-panel"
            aria-labelledby="portfolio-evolution-holdings-title"
          >
            <header className="portfolio-evolution__holdings-header">
              <div>
                <h3 id="portfolio-evolution-holdings-title">
                  <Stack size={22} weight="regular" aria-hidden="true" />
                  Historical Holdings
                </h3>
                <div className="portfolio-evolution__selected-date">
                  <div className="portfolio-evolution__selected-date-primary">
                    <strong>{selectedEvent ? formatPortfolioDate(selectedEvent.executionDate) : "No event selected"}</strong>
                    {selectedEvent && (
                      <span className="portfolio-evolution__holdings-count">
                        {selectedEvent.count} Holdings
                      </span>
                    )}
                  </div>
                  {selectedEvent && (
                    <span className="portfolio-evolution__signal-date">
                      Signal: {formatPortfolioDate(selectedEvent.signalDate)}
                    </span>
                  )}
                </div>
              </div>
              <ExportMenu
                onExport={exportHoldings}
                disabled={!selectedEvent || !filteredRows.length}
                busy={exporting}
                ariaLabel="Export selected historical holdings"
              />
            </header>

            <div className="portfolio-evolution__toolbar">
              <label className="portfolio-evolution__search">
                <MagnifyingGlass size={17} weight="regular" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder="Search ticker or company…"
                  aria-label="Search historical holdings by ticker or company"
                  onChange={(event) => updateSearch(event.target.value)}
                />
              </label>
              <div className="portfolio-evolution__filters" aria-label="Holding status filters">
                {HOLDINGS_STATUSES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={status === value}
                    onClick={() => chooseStatus(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="portfolio-evolution__table-wrap">
              <table className="portfolio-evolution__holdings-table">
                <caption className="visually-hidden">
                  Holdings for {selectedEvent ? formatPortfolioDate(selectedEvent.executionDate) : "the selected event"}
                </caption>
                <colgroup>
                  <col className="portfolio-evolution__col-rank" />
                  <col className="portfolio-evolution__col-ticker" />
                  <col className="portfolio-evolution__col-weight" />
                  <col className="portfolio-evolution__col-change" />
                  <col className="portfolio-evolution__col-status" />
                </colgroup>
                <thead>
                  <tr>
                    {HOLDINGS_SORT_FIELDS.map(({ key, label, slug }) => (
                      <th
                        key={key}
                        scope="col"
                        className={`portfolio-evolution__${slug}-heading`}
                        aria-sort={sort.key === key
                          ? (sort.direction === "asc" ? "ascending" : "descending")
                          : "none"}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(key)}
                          aria-label={`Sort by ${label}`}
                        >
                          <span>{label}</span>
                          <SortIcon active={sort.key === key} direction={sort.direction} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableSkeletonRows
                      columns={HOLDINGS_COLUMNS}
                      rows={PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE}
                    />
                  ) : unavailable ? (
                    <TableStateRow
                      columns={HOLDINGS_COLUMNS}
                      state="empty"
                      title="Holdings unavailable"
                      detail={block?.reason || "No valid holdings were published for this result."}
                    />
                  ) : tableEmpty ? (
                    <TableStateRow
                      columns={HOLDINGS_COLUMNS}
                      state="empty"
                      title="No matching holdings"
                      detail={query ? `No holdings match “${query}”.` : `No ${status} holdings in this event.`}
                    />
                  ) : holdings.rows.map((row) => {
                    const weightAvailable = historicalPortfolioWeightAvailable(row);
                    return (
                      <tr
                        key={`${row.status}-${row.ticker}`}
                        className="stock-row"
                        onClick={(event) => {
                          if (shouldOpenRow(event)) onSelectStock?.(row.ticker);
                        }}
                      >
                        <td className="portfolio-evolution__sequence">{row.sequence}</td>
                        <td className="portfolio-evolution__ticker" title={row.company}>
                          <a
                            className="portfolio-evolution__ticker-link"
                            href={stockPath(row.ticker)}
                            aria-label={stockLinkLabel(row.ticker)}
                            onClick={(event) => {
                              if (!shouldRouteTickerClick(event)) return;
                              event.preventDefault();
                              onSelectStock?.(row.ticker);
                            }}
                          >
                            {row.ticker}
                          </a>
                        </td>
                        <td
                          className={`portfolio-evolution__weight${weightAvailable ? "" : " is-unavailable"}`}
                          aria-label={weightAvailable
                            ? undefined
                            : "Historical portfolio weight unavailable"}
                          title={weightAvailable
                            ? undefined
                            : "Historical point-in-time portfolio weight unavailable"}
                        >
                          {formatHistoricalPortfolioWeight(row)}
                        </td>
                        <td className={`portfolio-evolution__change is-${weightChangeTone(row.change)}`}>
                          {formatWeightChange(row.change)}
                        </td>
                        <td className="portfolio-evolution__status-cell">
                          <span className={`portfolio-evolution__status is-${row.status}`}>
                            {row.statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!loading && selectedEvent && filteredRows.length > 0 && (
              <Pagination
                page={holdings.page}
                totalPages={holdings.totalPages}
                rangeStart={holdings.rangeStart}
                rangeEnd={holdings.rangeEnd}
                total={holdings.total}
                onPageChange={setHoldingsPage}
                label="Historical holdings pagination"
              />
            )}
          </section>
        </div>
    </section>
  );
}

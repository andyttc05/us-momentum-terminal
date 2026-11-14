import { useEffect, useMemo, useState } from "react";
import {
  CalendarBlank,
  CaretRight,
  ClockCounterClockwise,
  Info,
  MagnifyingGlass,
  Stack,
  TrendUp,
} from "@phosphor-icons/react";
import { DashboardCard } from "./DashboardCard.jsx";
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
import {
  HOLDINGS_STATUSES,
  PORTFOLIO_EVOLUTION_EVENTS_PAGE_SIZE,
  PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE,
  buildPortfolioEvolutionExportData,
  companyIndex,
  comparePortfolioEvent,
  eventsForYear,
  formatPortfolioDate,
  formatTurnover,
  normalizePortfolioEvents,
  paginatePortfolioRows,
  portfolioEventYears,
  portfolioEvolutionFilename,
  resolveEventSelection,
  summarizePortfolioEvents,
  visiblePortfolioRows,
} from "../utils/portfolioEvolution.js";

const HOLDINGS_COLUMNS = 5;

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
      filteredRows,
      holdingsPage,
      PORTFOLIO_EVOLUTION_HOLDINGS_PAGE_SIZE,
    ),
    [filteredRows, holdingsPage],
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

  function updateSearch(nextQuery) {
    setQuery(nextQuery);
    setHoldingsPage(1);
  }

  async function exportHoldings(format) {
    if (!selectedEvent || !filteredRows.length || exporting) return;
    setExporting(true);
    try {
      const exportData = buildPortfolioEvolutionExportData({
        block,
        config,
        selectedEvent,
        rows: filteredRows,
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
    <DashboardCard className="portfolio-evolution-card">
      <section
        className="portfolio-evolution"
        aria-labelledby="portfolio-evolution-title"
        data-state={state}
        aria-busy={loading || undefined}
      >
        <header className="portfolio-evolution__header">
          <span className="portfolio-evolution__header-icon" aria-hidden="true">
            <Stack size={31} weight="regular" />
          </span>
          <div>
            <h2 id="portfolio-evolution-title">Portfolio Evolution</h2>
            <p>Explore historical rebalancing events and portfolio composition.</p>
          </div>
        </header>

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
                <p>Select a rebalance event to view its holdings.</p>
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
                  {Array.from({ length: 4 }, (_, index) => (
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
                  <ClockCounterClockwise size={22} weight="regular" aria-hidden="true" />
                  Historical Holdings
                </h3>
                <div className="portfolio-evolution__selected-date">
                  <strong>{selectedEvent ? formatPortfolioDate(selectedEvent.executionDate) : "No event selected"}</strong>
                  {selectedEvent && (
                    <span>
                      Signal: {formatPortfolioDate(selectedEvent.signalDate)}
                      <i aria-hidden="true" />
                      {selectedEvent.count} Holdings
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
                    {label} ({comparison.counts[value]})
                  </button>
                ))}
              </div>
            </div>

            <div className="portfolio-evolution__table-wrap">
              <table className="portfolio-evolution__holdings-table">
                <caption className="visually-hidden">
                  Holdings for {selectedEvent ? formatPortfolioDate(selectedEvent.executionDate) : "the selected event"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Ticker</th>
                    <th scope="col">Company</th>
                    <th scope="col" className="is-number">
                      {status === "removed" ? "Previous Weight" : "Target Weight"}
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableSkeletonRows columns={HOLDINGS_COLUMNS} rows={10} />
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
                  ) : holdings.rows.map((row) => (
                    <tr key={`${row.status}-${row.ticker}`}>
                      <td className="portfolio-evolution__sequence">{row.sequence}</td>
                      <td className="portfolio-evolution__ticker">{row.ticker}</td>
                      <td className="portfolio-evolution__company" title={row.company}>{row.company}</td>
                      <td className="portfolio-evolution__weight">{formatTurnover(row.weight)}</td>
                      <td>
                        <span className={`portfolio-evolution__status is-${row.status}`}>
                          {row.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
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

            <p className="portfolio-evolution__method-note">
              <Info size={14} weight="regular" aria-hidden="true" />
              Historical weights use an equal-weight research proxy because point-in-time float-adjusted
              market capitalisation is unavailable.
            </p>
          </section>
        </div>
      </section>
    </DashboardCard>
  );
}

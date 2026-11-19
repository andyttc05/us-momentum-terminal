import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaretUpDown,
  ChartBar,
  ChartPieSlice,
  CheckCircle,
  ShareNetwork,
  ShieldCheck,
  Stack,
  Target,
  WarningCircle,
  Briefcase,
} from "@phosphor-icons/react";
import { TableSkeletonRows, TableStateRow } from "./components/DataState.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { ExportMenu } from "./components/ExportMenu.jsx";
import { KpiCard } from "./components/KpiCard.jsx";
import { MascotDuo } from "./components/Mascot.jsx";
import { NextRebalanceCard } from "./components/NextRebalanceCard.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { Pagination } from "./components/Pagination.jsx";
import { SectorAllocation } from "./components/SectorAllocation.jsx";
import { Toast } from "./components/Toast.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useMarket } from "./api/MarketProvider.jsx";
import { useUniverse } from "./api/UniverseProvider.jsx";
import { downloadCsvFile } from "./utils/csv.js";
import { getSectionState } from "./utils/dataState.js";
import { downloadWorkbookFile } from "./utils/exportFiles.js";
import { evaluatePortfolioConstraints } from "./utils/portfolioConstraints.js";
import {
  buildPortfolioCsv,
  buildPortfolioExportData,
  portfolioFilename,
  validatePortfolioForExport,
} from "./utils/portfolioExport.js";
import { getPortfolioState } from "./utils/portfolioState.js";
import { selectLiveBook, simulateLiveWeights } from "./utils/liveWeights.js";
import { shouldOpenRow, shouldRouteTickerClick, stockLinkLabel } from "./utils/rowNavigation.js";
import {
  datasetForUniverse,
  targetHoldingsForDataset,
} from "./utils/universeState.js";
import { stockPath } from "./router.jsx";

const rowsPerPage = 10;
// Both views render the same table with a different column list, so a reader
// moving between Holdings and Live Momentum sees one design, not two.
// [field, visible label, full accessible label, alignment class]
// Visible labels stay short so a heading never wraps; the full wording travels
// in each heading's tooltip and aria-label.
const holdingsColumns = [
  ["rank", "#", "Rank", "rank"],
  ["ticker", "Ticker", "Ticker", "ticker"],
  ["sector", "Sector", "Sector at Rebalance", "sector"],
  ["score", "Score", "Score at Rebalance", "score"],
  ["floatAdjustedMarketCapValue", "Float Cap", "Float-Adjusted Market Cap at Rebalance", "market-cap"],
  ["finalWeight", "Weight", "Target Weight", "final-weight"],
];

const liveColumns = [
  ["rank", "#", "Current Rank", "rank"],
  ["ticker", "Ticker", "Ticker", "ticker"],
  ["sector", "Sector", "Sector", "sector"],
  ["score", "Score", "Momentum Score", "score"],
  ["momentum", "12–1", "12–1 Momentum", "score"],
  ["floatMarketCap", "Float Cap", "Float-Adjusted Market Cap", "market-cap"],
  // This table describes a book rebuilt from today's signal, so its weight is
  // simulated from that signal — not the size frozen at the last rebalance.
  ["weight", "Weight", "Simulated Target Weight — score × √(float cap ÷ median float cap), 9% name / 35% sector caps", "final-weight"],
  ["status", "Status", "Portfolio Status", "status"],
];

const portfolioViews = [["holdings", "Holdings"], ["live", "Live Momentum"]];

const displayPercent = (value) => `${value.toFixed(1)}%`;

/** Compact dollar label for the live-signal table's market-cap column. */
function formatLiveMarketCap(value) {
  if (!value) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(0)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value)}`;
}

/** One comparator for both tables: text sorts alphabetically, numbers by value. */
function compareBy(key, direction) {
  const sign = direction === "asc" ? 1 : -1;
  return (left, right) => {
    const a = left[key];
    const b = right[key];
    const result = typeof a === "string" || typeof b === "string"
      ? String(a ?? "").localeCompare(String(b ?? ""))
      : (a ?? 0) - (b ?? 0);
    return result * sign;
  };
}

const constraintIcons = {
  "max-stock": Stack,
  "max-sector": ShareNetwork,
  "target-holdings": ChartBar,
  "target-allocation": Target,
};

function SortIcon({ active, direction }) {
  if (!active) return <CaretUpDown size={14} weight="bold" aria-hidden="true" />;
  return direction === "asc"
    ? <ArrowUp size={14} weight="bold" aria-hidden="true" />
    : <ArrowDown size={14} weight="bold" aria-hidden="true" />;
}

/** The one column-heading row both tables share. */
function ColumnHeadings({ columns, sort, onSort }) {
  return (
    <thead>
      <tr>
        {columns.map(([key, label, fullLabel, align]) => (
          <th
            scope="col"
            key={key}
            title={fullLabel}
            aria-label={fullLabel}
            className={`portfolio-heading portfolio-heading--${align}`}
            aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
          >
            <button type="button" aria-label={`Sort by ${fullLabel}`} title={fullLabel} onClick={() => onSort(key)}>
              <span>{label}</span>
              <SortIcon active={sort.key === key} direction={sort.direction} />
            </button>
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * Tracks whether the holdings table has columns off-screen and whether the
 * reader has reached the end of it. The stylesheet uses that to draw a soft
 * fade on the right edge — the only cue a phone needs that the table scrolls
 * sideways — and to drop it again at the end of the scroll.
 */
function useTableScrollHint(ref, dependencies) {
  const [state, setState] = useState({ scrollable: false, atEnd: false });

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const max = node.scrollWidth - node.clientWidth;
        setState((current) => {
          const next = { scrollable: max > 1, atEnd: max > 1 && node.scrollLeft >= max - 1 };
          // Reuse the previous object when nothing changed, so React can bail out
          // instead of re-rendering on every scroll and resize notification.
          return current.scrollable === next.scrollable && current.atEnd === next.atEnd ? current : next;
        });
      });
    };

    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);

    return () => {
      window.cancelAnimationFrame(frame);
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref, ...dependencies]);

  return state;
}

export function PortfolioPage({ onSelectStock, hidden = false }) {
  const [holdingsSort, setHoldingsSort] = useState({ key: "finalWeight", direction: "desc" });
  // The live table opens on the largest simulated size, like Holdings does.
  const [liveSort, setLiveSort] = useState({ key: "weight", direction: "desc" });
  const [page, setPage] = useState(1);
  const [livePage, setLivePage] = useState(1);
  const [toast, setToast] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [activeView, setActiveView] = useState("holdings");
  const {
    data,
    error,
    meta,
    refresh,
    status,
    refreshing,
    strategyRebalanceFrequency,
  } = useMarket();
  const { activeUniverse } = useUniverse();

  const universe = activeUniverse;
  // One dataset drives the book, its summary, its sector split and the
  // constraint targets: nothing here is sized from a fixed 100-holding guess.
  const dataset = datasetForUniverse(data, activeUniverse);
  const portfolio = dataset?.portfolio ?? null;
  const liveSignals = dataset?.liveSignals?.rows ?? data?.stocks ?? [];
  const targetHoldings = targetHoldingsForDataset(dataset, activeUniverse);
  const portfolioHoldings = portfolio?.holdings ?? [];
  const portfolioSectors = portfolio?.sectors ?? [];
  const portfolioSummary = portfolio?.summary ?? null;
  const publishedRebalanceFrequency = portfolio?.metadata?.rebalanceFrequency ?? data?.backtest?.[activeUniverse]?.methodology?.rebalance_frequency;
  const rebalanceFrequency = strategyRebalanceFrequency ?? publishedRebalanceFrequency;
  const portfolioState = getPortfolioState({
    portfolio,
    status,
    meta,
    error,
    targetHoldings,
  });
  const portfolioReady = portfolioState.kind === "ready" || portfolioState.kind === "cached";
  const pendingKpi = portfolioState.kind === "loading" ? "Loading…" : "Unavailable";
  const holdingsState = getSectionState({
    hasData: portfolioHoldings.length > 0,
    status,
    error,
    refreshing,
  });
  const sectorState = getSectionState({
    hasData: portfolioSectors.length > 0,
    status,
    error,
    refreshing,
  });

  useEffect(() => {
    setPage(1);
    setLivePage(1);
  }, [universe]);

  const sortedHoldings = useMemo(
    () => [...portfolioHoldings].sort(compareBy(holdingsSort.key, holdingsSort.direction)),
    [portfolioHoldings, holdingsSort],
  );

  // Live signals cover the whole ranked universe; today's book is the top
  // `targetHoldings` names that can actually be sized. Its weights are
  // simulated from this signal, because the published weights belong to the
  // last rebalance and would describe a different, older book.
  const liveBook = useMemo(
    () => selectLiveBook(liveSignals, targetHoldings),
    [liveSignals, targetHoldings],
  );
  const liveWeighting = useMemo(
    () => (liveBook.length === targetHoldings ? simulateLiveWeights(liveBook) : null),
    [liveBook, targetHoldings],
  );

  const liveRows = useMemo(() => {
    const heldTickers = new Set(portfolioHoldings.map((holding) => holding.ticker));
    return liveBook.map((row, index) => {
      const weight = liveWeighting?.weights.get(row.ticker);
      const held = heldTickers.has(row.ticker);
      const potential = row.activePortfolioStatus === "potential_new_entry";
      return {
        rank: row.rank ?? index + 1,
        ticker: row.ticker,
        sector: row.sector,
        score: Number(row.score ?? row.momentumScore ?? 0),
        momentum: Number(row.momentum ?? 0),
        floatMarketCap: row.floatMarketCap,
        weight: Number.isFinite(weight) ? weight : null,
        status: held ? "Currently Held" : potential ? "Potential New Entry" : "Outside Active Portfolio",
        held,
      };
    });
  }, [liveBook, liveWeighting, portfolioHoldings]);

  const sortedLiveRows = useMemo(
    () => [...liveRows].sort(compareBy(liveSort.key, liveSort.direction)),
    [liveRows, liveSort],
  );

  const totalPages = Math.max(1, Math.ceil(sortedHoldings.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * rowsPerPage;
  const visibleHoldings = sortedHoldings.slice(firstIndex, firstIndex + rowsPerPage);
  const firstResult = visibleHoldings.length ? firstIndex + 1 : 0;
  const lastResult = Math.min(firstIndex + rowsPerPage, sortedHoldings.length);

  // Live Momentum pages exactly like Holdings: same page size, same footer.
  const liveTotalPages = Math.max(1, Math.ceil(sortedLiveRows.length / rowsPerPage));
  const liveCurrentPage = Math.min(livePage, liveTotalPages);
  const liveFirstIndex = (liveCurrentPage - 1) * rowsPerPage;
  const visibleLiveRows = sortedLiveRows.slice(liveFirstIndex, liveFirstIndex + rowsPerPage);
  const liveFirstResult = visibleLiveRows.length ? liveFirstIndex + 1 : 0;
  const liveLastResult = Math.min(liveFirstIndex + rowsPerPage, sortedLiveRows.length);

  const constraintEvaluation = useMemo(
    () => evaluatePortfolioConstraints(portfolioHoldings, targetHoldings),
    [portfolioHoldings, targetHoldings],
  );

  const tableScrollRef = useRef(null);
  // Only primitive values are depended on: the visible page and the sort order.
  // Depending on the sliced array itself would re-run the effect on every
  // render, because `.slice()` returns a new array each time.
  const tableScroll = useTableScrollHint(tableScrollRef, [
    currentPage,
    holdingsSort.key,
    holdingsSort.direction,
    activeView,
    sortedHoldings.length,
    liveCurrentPage,
    liveSort.key,
    liveSort.direction,
    sortedLiveRows.length,
  ]);

  /** Same toggle for both tables: same column flips, a new column starts ascending. */
  function toggleSort(setter, key, onReset) {
    setter((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
    onReset();
  }

  function showToast(message, kind = "updated", duration = 2600) {
    setToast({ message, kind, duration });
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => setToast(""), duration);
  }

  /** Export the complete selected portfolio — every holding, not the visible page. */
  async function exportPortfolio(format) {
    if (isExporting) return;
    const holdings = portfolio?.holdings ?? [];
    const report = validatePortfolioForExport({
      holdings,
      validation: portfolio?.validation,
      constraints: portfolio?.constraints,
    });

    if (!report.ok) {
      showToast("Export blocked", "error", 4200);
      return;
    }

    setIsExporting(true);
    try {
      const filename = portfolioFilename(universe, format);
      if (format === "csv") {
        downloadCsvFile(filename, buildPortfolioCsv(holdings));
      } else {
        const exportData = buildPortfolioExportData({
          portfolio,
          universe,
          meta,
          exportedAt: new Date().toISOString(),
        });
        await downloadWorkbookFile(filename, exportData.workbookSheets);
      }
      showToast("Export completed");
    } catch (error) {
      showToast(error?.message || "Export failed", "error", 4200);
    } finally {
      setIsExporting(false);
    }
  }

  async function refreshSnapshot() {
    await refresh();
  }

  return (
    <main className="app-main" hidden={hidden}>
      <div className="page portfolio-page" id="portfolio">
        <PageHeader
          eyebrow="Portfolio"
          title="Model Portfolio"
          subtitle={`Systematic Momentum · ${activeUniverse === "top20" ? "Top 20" : "Top 100"}`}
          art={<MascotDuo creamColor="var(--color-surface)" yellowColor="var(--color-yellow)" />}
          controls={(
            <UpdateBar
              ariaLabel="Refresh portfolio"
              onRefresh={refreshSnapshot}
            />
          )}
        />

        <section className="overview-kpis portfolio-kpis" aria-label="Portfolio summary">
          <KpiCard loading={portfolioState.kind === "loading"} label="Total Holdings" value={portfolioSummary?.totalHoldings ?? pendingKpi} icon={Briefcase} tint="cream" mascotVariant="cream" mascotColor="var(--color-cream)" />
          <KpiCard loading={portfolioState.kind === "loading"} label="Invested Capital" value={portfolioSummary ? `${Math.round(portfolioSummary.investedCapital)}%` : pendingKpi} icon={Target} tint="blue" mascotVariant="blue" mascotColor="var(--color-blue)" />
          <KpiCard loading={portfolioState.kind === "loading"} label="Top 10 Weight" value={portfolioSummary ? displayPercent(portfolioSummary.topTenWeight) : pendingKpi} icon={ChartPieSlice} tint="pink" mascotVariant="pink" mascotColor="var(--color-pink)" />
          <KpiCard loading={portfolioState.kind === "loading"} label="Largest Holding" value={portfolioSummary?.largestHolding?.ticker ?? pendingKpi} icon={Stack} tint="mint" mascotVariant="mint" mascotColor="var(--color-mint)" />
        </section>

        <section className="portfolio-summary-grid" aria-label="Portfolio allocation and constraints">
          <DashboardCard title="Sector Allocation" className="portfolio-sector-card">
            <SectorAllocation
              sectors={portfolioSectors}
              state={sectorState}
              className="portfolio-sector-content"
            />
          </DashboardCard>

          <NextRebalanceCard frequency={rebalanceFrequency} portfolio={portfolio} today={meta?.as_of} />

          <section className="dashboard-card portfolio-constraints" aria-labelledby="portfolio-constraints-title">
            <div className="dashboard-card__header">
              <h3 className="dashboard-card__title portfolio-constraints__title" id="portfolio-constraints-title">
                <ShieldCheck size={25} weight="fill" aria-hidden="true" />
                Constraints
              </h3>
            </div>
            <div className="dashboard-card__body">
              {portfolioReady ? (
                <ul className="portfolio-constraint-list">
                  {constraintEvaluation.constraints.map((constraint) => {
                    const Icon = constraint.passed ? CheckCircle : WarningCircle;
                    const LeadingIcon = constraintIcons[constraint.id];
                    const statusLabel = constraint.status === "passed"
                      ? "passed"
                      : constraint.status === "failed"
                        ? "failed"
                        : "not evaluated";
                    return (
                      <li
                        className={`portfolio-constraint is-${constraint.status}`}
                        key={constraint.id}
                        aria-label={`${constraint.label} ${constraint.rule}: ${statusLabel}`}
                        title={`${constraint.label} ${constraint.rule}: ${statusLabel}`}
                      >
                        <LeadingIcon className="portfolio-constraint__icon" size={23} weight="bold" aria-hidden="true" />
                        <span>{constraint.label}</span>
                        <strong>{constraint.rule}</strong>
                        <Icon size={24} weight="fill" aria-hidden="true" />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="portfolio-inline-state" role="status">
                  {portfolioState.kind === "infeasible" ? "Portfolio infeasible" : "Not evaluated"}
                </div>
              )}
            </div>
          </section>
        </section>

        <DashboardCard
          className="portfolio-holdings-card"
          headerContent={(
            <div className="portfolio-card-toolbar">
              <h3 className="dashboard-card__title">
                {activeView === "holdings" ? "Active Portfolio Holdings" : "Live Momentum Signals"}
              </h3>
              <div className="portfolio-card-toolbar__actions">
                <div className="period-control" role="group" aria-label="Portfolio holdings view">
                  {portfolioViews.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={activeView === id}
                      onClick={() => setActiveView(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="portfolio-export-control">
                  <ExportMenu
                    onExport={exportPortfolio}
                    disabled={!portfolioReady}
                    busy={isExporting}
                    ariaLabel="Export the complete portfolio"
                  />
                </div>
              </div>
            </div>
          )}
        >
          {activeView === "live" ? (
            <div className={`portfolio-table-shell${tableScroll.scrollable ? " is-scrollable" : ""}${tableScroll.atEnd ? " is-at-end" : ""}`}>
              <div
                className="portfolio-table-scroll"
                ref={tableScrollRef}
                role="region"
                aria-label="Live momentum table — scroll horizontally for the remaining columns"
                tabIndex={0}
              >
                <table className="portfolio-table portfolio-live-table">
                  <colgroup>
                    <col className="portfolio-col-rank" />
                    <col className="portfolio-col-live-ticker" />
                    <col className="portfolio-col-live-sector" />
                    <col className="portfolio-col-live-score" />
                    <col className="portfolio-col-live-momentum" />
                    <col className="portfolio-col-live-market-cap" />
                    <col className="portfolio-col-live-weight" />
                    <col className="portfolio-col-live-status" />
                  </colgroup>
                  <ColumnHeadings
                    columns={liveColumns}
                    sort={liveSort}
                    onSort={(key) => toggleSort(setLiveSort, key, () => setLivePage(1))}
                  />
                  <tbody>
                    {visibleLiveRows.length ? visibleLiveRows.map((row) => (
                      <tr
                        key={row.ticker}
                        className="stock-row"
                        onClick={(event) => {
                          if (shouldOpenRow(event)) onSelectStock?.(row.ticker);
                        }}
                      >
                        <td className="portfolio-rank-cell">{row.rank}</td>
                        <td className="portfolio-ticker-cell">
                          <a
                            className="portfolio-ticker-link"
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
                        <td className="portfolio-sector-cell" title={row.sector}>{row.sector}</td>
                        <td className="portfolio-number-cell">{row.score.toFixed(2)}</td>
                        <td className="portfolio-number-cell">{row.momentum.toFixed(1)}%</td>
                        <td className="portfolio-number-cell">{formatLiveMarketCap(row.floatMarketCap)}</td>
                        <td className="portfolio-number-cell is-emphasis">{row.weight === null ? "—" : displayPercent(row.weight)}</td>
                        <td className={`portfolio-status-cell${row.held ? " is-held" : ""}`}>{row.status}</td>
                      </tr>
                    )) : (
                      <TableStateRow
                        columns={liveColumns.length}
                        state="empty"
                        title="No signals available"
                        detail="The latest momentum scores are not published yet."
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className={`portfolio-table-shell${tableScroll.scrollable ? " is-scrollable" : ""}${tableScroll.atEnd ? " is-at-end" : ""}`}>
              <div
                className="portfolio-table-scroll"
                ref={tableScrollRef}
                role="region"
                aria-label="Holdings table — scroll horizontally for the remaining columns"
                tabIndex={0}
              >
                <table
                  className="portfolio-table"
                  data-state={holdingsState}
                  aria-busy={holdingsState === "loading" || undefined}
                >
                  <colgroup>
                    <col className="portfolio-col-rank" />
                    <col className="portfolio-col-ticker" />
                    <col className="portfolio-col-sector" />
                    <col className="portfolio-col-score" />
                    <col className="portfolio-col-market-cap" />
                    <col className="portfolio-col-final-weight" />
                  </colgroup>
                  <ColumnHeadings
                    columns={holdingsColumns}
                    sort={holdingsSort}
                    onSort={(key) => toggleSort(setHoldingsSort, key, () => setPage(1))}
                  />
                  <tbody>
                    {holdingsState === "loading" ? (
                      <TableSkeletonRows columns={holdingsColumns.length} rows={rowsPerPage} />
                    ) : !portfolioReady ? (
                      <TableStateRow
                        columns={holdingsColumns.length}
                        state={holdingsState}
                        title={portfolioState.title}
                        detail={portfolioState.detail}
                      />
                    ) : visibleHoldings.length ? visibleHoldings.map((holding) => (
                      <tr
                        key={holding.ticker}
                        className="stock-row"
                        onClick={(event) => {
                          if (shouldOpenRow(event)) onSelectStock?.(holding.ticker);
                        }}
                      >
                        <td className="portfolio-rank-cell">{holding.rank}</td>
                        <td className="portfolio-ticker-cell">
                          <a
                            className="portfolio-ticker-link"
                            href={stockPath(holding.ticker)}
                            aria-label={stockLinkLabel(holding.ticker)}
                            onClick={(event) => {
                              if (!shouldRouteTickerClick(event)) return;
                              event.preventDefault();
                              onSelectStock?.(holding.ticker);
                            }}
                          >
                            {holding.ticker}
                          </a>
                        </td>
                        <td className="portfolio-sector-cell" title={holding.sector}>{holding.sector}</td>
                        <td className="portfolio-number-cell">{holding.score.toFixed(2)}</td>
                        <td className="portfolio-number-cell">{holding.floatAdjustedMarketCap}</td>
                        <td className="portfolio-number-cell is-emphasis">{displayPercent(holding.finalWeight)}</td>
                      </tr>
                    )) : (
                      <TableStateRow
                        columns={holdingsColumns.length}
                        state="empty"
                        title="No holdings available"
                        detail="The current portfolio has no rows to display."
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {activeView === "holdings" ? (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              rangeStart={firstResult}
              rangeEnd={lastResult}
              total={sortedHoldings.length}
              onPageChange={setPage}
              label="Holdings table pagination"
            />
          ) : (
            <Pagination
              page={liveCurrentPage}
              totalPages={liveTotalPages}
              rangeStart={liveFirstResult}
              rangeEnd={liveLastResult}
              total={sortedLiveRows.length}
              onPageChange={setLivePage}
              label="Live momentum table pagination"
            />
          )}
        </DashboardCard>
      </div>
      {toast && <Toast kind={toast.kind} message={toast.message} className="page-toast" durationMs={toast.duration} />}
    </main>
  );
}

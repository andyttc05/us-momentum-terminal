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
import { DataState, Skeleton, TableSkeletonRows, TableStateRow } from "./components/DataState.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { ExportMenu } from "./components/ExportMenu.jsx";
import { KpiCard } from "./components/KpiCard.jsx";
import { MascotDuo } from "./components/Mascot.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { Pagination } from "./components/Pagination.jsx";
import { SectorAllocation } from "./components/SectorAllocation.jsx";
import { Toast } from "./components/Toast.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useMediaQuery } from "./components/useMediaQuery.js";
import { useMarket } from "./api/MarketProvider.jsx";
import { useUniverse } from "./api/UniverseProvider.jsx";
import { PHONE_TABLE_MEDIA_QUERY } from "./utils/breakpoints.js";
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
import { shouldOpenRow, shouldRouteTickerClick, stockLinkLabel } from "./utils/rowNavigation.js";
import {
  datasetForUniverse,
  targetHoldingsForDataset,
} from "./utils/universeState.js";
import { stockPath } from "./router.jsx";

const rowsPerPage = 10;
// [field, label, class suffix, short label used on phones]
const sortableFields = [
  ["rank", "#", "rank"],
  ["ticker", "Ticker", "ticker"],
  ["sector", "Sector", "sector"],
  ["score", "Score", "score"],
  ["floatAdjustedMarketCapValue", "Float-Adj. Market Cap", "market-cap", "Mkt Cap"],
  ["rawWeight", "Raw Weight", "raw-weight"],
  ["finalWeight", "Final Weight", "final-weight"],
];

const displayPercent = (value) => `${value.toFixed(1)}%`;

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
  const [sort, setSort] = useState({ key: "finalWeight", direction: "desc" });
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const { data, error, meta, refresh, status, refreshing } = useMarket();
  const { activeUniverse } = useUniverse();
  // Phones drop the rank column so the ticker can pin to the left edge without
  // an empty lane beside it. The rank stays on every holding and in the CSV
  // export; only the phone table stops rendering the cell.
  const isPhone = useMediaQuery(PHONE_TABLE_MEDIA_QUERY);

  const universe = activeUniverse;
  // One dataset drives the book, its summary, its sector split and the
  // constraint targets: nothing here is sized from a fixed 100-holding guess.
  const dataset = datasetForUniverse(data, activeUniverse);
  const portfolio = dataset?.portfolio ?? null;
  const targetHoldings = targetHoldingsForDataset(dataset, activeUniverse);
  const portfolioHoldings = portfolio?.holdings ?? [];
  const portfolioSectors = portfolio?.sectors ?? [];
  const portfolioPreviewValidation = portfolio?.validation ?? { maximumHoldingWeight: 9 };
  const portfolioSummary = portfolio?.summary ?? null;
  const snapshot = dataset?.overview?.snapshot;
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
  const columnCount = isPhone ? 6 : 7;

  useEffect(() => {
    setPage(1);
  }, [universe]);

  const sortedHoldings = useMemo(() => [...portfolioHoldings].sort((left, right) => {
    const a = left[sort.key];
    const b = right[sort.key];
    const result = typeof a === "string" ? a.localeCompare(b) : a - b;
    return result * (sort.direction === "asc" ? 1 : -1);
  }), [portfolioHoldings, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedHoldings.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * rowsPerPage;
  const visibleHoldings = sortedHoldings.slice(firstIndex, firstIndex + rowsPerPage);
  const firstResult = visibleHoldings.length ? firstIndex + 1 : 0;
  const lastResult = Math.min(firstIndex + rowsPerPage, sortedHoldings.length);

  const largestPositions = useMemo(
    () => [...portfolioHoldings].sort((left, right) => right.finalWeight - left.finalWeight).slice(0, 5),
    [portfolioHoldings],
  );
  const constraintEvaluation = useMemo(
    () => evaluatePortfolioConstraints(portfolioHoldings, targetHoldings),
    [portfolioHoldings, targetHoldings],
  );

  const tableScrollRef = useRef(null);
  // Only primitive values are depended on: the visible page and the sort order.
  // Depending on the sliced array itself would re-run the effect on every
  // render, because `.slice()` returns a new array each time.
  const tableScroll = useTableScrollHint(tableScrollRef, [currentPage, sort.key, sort.direction, sortedHoldings.length]);

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
    setPage(1);
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
          subtitle="Momentum × √Float-Adj. Cap"
          art={<MascotDuo creamColor="var(--color-surface)" yellowColor="var(--color-yellow)" />}
          controls={(
            <UpdateBar
              dateTime={snapshot?.asOf}
              ariaLabel="Refresh portfolio"
              onRefresh={refreshSnapshot}
            />
          )}
        />

        <section className="overview-kpis portfolio-kpis" aria-label="Portfolio summary">
          <KpiCard loading={portfolioState.kind === "loading"} label="Total Holdings" value={portfolioSummary?.totalHoldings ?? pendingKpi} icon={Briefcase} tint="cream" mascotVariant="cream" mascotColor="var(--color-cream)" />
          <KpiCard loading={portfolioState.kind === "loading"} label="Largest Holding" value={portfolioSummary?.largestHolding?.ticker ?? pendingKpi} icon={Stack} tint="mint" mascotVariant="mint" mascotColor="var(--color-mint)" />
          <KpiCard loading={portfolioState.kind === "loading"} label="Top 10 Weight" value={portfolioSummary ? displayPercent(portfolioSummary.topTenWeight) : pendingKpi} icon={ChartPieSlice} tint="pink" mascotVariant="pink" mascotColor="var(--color-pink)" />
          <KpiCard loading={portfolioState.kind === "loading"} label="Invested Capital" value={portfolioSummary ? `${Math.round(portfolioSummary.investedCapital)}%` : pendingKpi} icon={Target} tint="blue" mascotVariant="blue" mascotColor="var(--color-blue)" />
        </section>

        <section className="portfolio-summary-grid" aria-label="Portfolio allocation and constraints">
          <DashboardCard title="Sector Allocation" className="portfolio-sector-card">
            <SectorAllocation
              sectors={portfolioSectors}
              state={sectorState}
              className="portfolio-sector-content"
            />
          </DashboardCard>

          <DashboardCard title="Stock Weight Distribution" className="portfolio-weight-card">
            {portfolioReady ? (
              <div className="portfolio-weight-list">
              {largestPositions.map((holding) => (
                <div className="portfolio-weight-row" key={holding.ticker}>
                  <strong className="portfolio-weight-row__ticker">{holding.ticker}</strong>
                  <div
                    className="portfolio-weight-row__track"
                    role="img"
                    aria-label={`${holding.ticker}: ${displayPercent(holding.finalWeight)} of portfolio`}
                  >
                    <span style={{ width: `${(holding.finalWeight / portfolioPreviewValidation.maximumHoldingWeight) * 100}%` }} />
                  </div>
                  <strong className="portfolio-weight-row__value">{displayPercent(holding.finalWeight)}</strong>
                </div>
              ))}
              </div>
            ) : holdingsState === "loading" ? (
              <div className="portfolio-weight-list" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <div className="portfolio-weight-row" key={index}>
                    <Skeleton width="34px" height="13px" />
                    <Skeleton height="25px" />
                    <Skeleton width="42px" height="13px" style={{ justifySelf: "end" }} />
                  </div>
                ))}
              </div>
            ) : (
              <DataState
                state={holdingsState}
                title={portfolioState.title}
                detail={portfolioState.detail}
              />
            )}
          </DashboardCard>

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
          title="Holdings"
          className="portfolio-holdings-card"
          action={(
            <div className="portfolio-export-control">
              <ExportMenu
                onExport={exportPortfolio}
                disabled={!portfolioReady}
                busy={isExporting}
                ariaLabel="Export the complete portfolio"
              />
            </div>
          )}
        >
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
                  {!isPhone && <col className="portfolio-col-rank" />}
                  <col className="portfolio-col-ticker" />
                  <col className="portfolio-col-sector" />
                  <col className="portfolio-col-score" />
                  <col className="portfolio-col-market-cap" />
                  <col className="portfolio-col-raw-weight" />
                  <col className="portfolio-col-final-weight" />
                </colgroup>
                <thead>
                  <tr>
                    {!isPhone && <th scope="col" className="portfolio-heading portfolio-heading--rank"><span>#</span></th>}
                    {sortableFields.slice(1).map(([key, label, className, shortLabel]) => (
                      <th scope="col" key={key} className={`portfolio-heading portfolio-heading--${className}`} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                        <button type="button" aria-label={`Sort by ${label}`} onClick={() => toggleSort(key)}>
                          <span className={shortLabel ? "portfolio-heading__full" : undefined}>{label}</span>
                          {shortLabel && <span className="portfolio-heading__short" aria-hidden="true">{shortLabel}</span>}
                          <SortIcon active={sort.key === key} direction={sort.direction} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdingsState === "loading" ? (
                    <TableSkeletonRows columns={columnCount} rows={rowsPerPage} />
                  ) : !portfolioReady ? (
                    <TableStateRow
                      columns={columnCount}
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
                      {!isPhone && <td className="portfolio-rank-cell"><span>{holding.rank}</span></td>}
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
                      <td className="portfolio-score-cell"><span>{holding.score.toFixed(2)}</span></td>
                      <td className="portfolio-market-cap-cell">{holding.floatAdjustedMarketCap}</td>
                      <td className="portfolio-weight-value-cell">{displayPercent(holding.rawWeight)}</td>
                      <td className="portfolio-weight-value-cell is-final">{displayPercent(holding.finalWeight)}</td>
                    </tr>
                  )) : (
                    <TableStateRow
                      columns={columnCount}
                      state="empty"
                      title="No holdings available"
                      detail="The current portfolio has no rows to display."
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            rangeStart={firstResult}
            rangeEnd={lastResult}
            total={sortedHoldings.length}
            onPageChange={setPage}
            label="Holdings table pagination"
          />
        </DashboardCard>
      </div>
      {toast && <Toast kind={toast.kind} message={toast.message} className="page-toast" durationMs={toast.duration} />}
    </main>
  );
}

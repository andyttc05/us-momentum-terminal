import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaretUpDown,
  ChartPieSlice,
  CheckCircle,
  DownloadSimple,
  Stack,
  Target,
  WarningCircle,
  Briefcase,
} from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { KpiCard } from "./components/KpiCard.jsx";
import { MascotDuo } from "./components/Mascot.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { Pagination } from "./components/Pagination.jsx";
import { SectorDonut } from "./components/SectorDonut.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useMarket } from "./api/MarketProvider.jsx";
import { downloadCsvFile } from "./utils/csv.js";
import { buildPortfolioCsv, portfolioCsvFilename, validatePortfolioForExport } from "./utils/portfolioExport.js";

const rowsPerPage = 10;
const sortableFields = [
  ["rank", "#", "rank"],
  ["ticker", "Ticker", "ticker"],
  ["sector", "Sector", "sector"],
  ["score", "Score", "score"],
  ["floatAdjustedMarketCapValue", "Float-Adj. Market Cap", "market-cap"],
  ["rawWeight", "Raw Weight", "raw-weight"],
  ["finalWeight", "Final Weight", "final-weight"],
];

const displayPercent = (value) => `${value.toFixed(1)}%`;

function SortIcon({ active, direction }) {
  if (!active) return <CaretUpDown size={13} weight="bold" aria-hidden="true" />;
  return direction === "asc"
    ? <ArrowUp size={13} weight="bold" aria-hidden="true" />
    : <ArrowDown size={13} weight="bold" aria-hidden="true" />;
}

export function PortfolioPage({ onSelectStock, hidden = false }) {
  const [sort, setSort] = useState({ key: "finalWeight", direction: "desc" });
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const { data, refresh } = useMarket();

  const portfolio = data?.portfolio ?? null;
  const portfolioHoldings = portfolio?.holdings ?? [];
  const portfolioSectors = portfolio?.sectors ?? [];
  const portfolioConstraints = portfolio?.constraints ?? [];
  const portfolioPreviewValidation = portfolio?.validation ?? { maximumHoldingWeight: 9 };
  const portfolioSummary = portfolio?.summary ?? null;
  const snapshot = data?.overview?.snapshot;

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
  const firstResult = firstIndex + 1;
  const lastResult = Math.min(firstIndex + rowsPerPage, sortedHoldings.length);

  const largestPositions = useMemo(
    () => [...portfolioHoldings].sort((left, right) => right.finalWeight - left.finalWeight).slice(0, 5),
    [portfolioHoldings],
  );

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
    setPage(1);
  }

  function showToast(message, duration = 2600) {
    setToast(message);
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => setToast(""), duration);
  }

  /** Export the complete portfolio — every holding, not the visible page. */
  function exportHoldingsCsv() {
    if (isExporting) return;
    const holdings = portfolio?.holdings ?? [];
    const report = validatePortfolioForExport({
      holdings,
      validation: portfolio?.validation,
      constraints: portfolio?.constraints,
    });

    if (!report.ok) {
      showToast(`Export blocked — ${report.problems[0]}.`, 4200);
      return;
    }

    setIsExporting(true);
    try {
      const csv = buildPortfolioCsv(holdings);
      const filename = portfolioCsvFilename(new Date());
      downloadCsvFile(filename, csv);
      showToast(`Exported ${report.rowCount} holdings to ${filename}`);
    } catch (error) {
      showToast("Export failed — please try again.", 4200);
    } finally {
      setIsExporting(false);
    }
  }

  async function refreshSnapshot() {
    const ok = await refresh();
    if (!ok) return;
    setToast("Portfolio re-valued from provider data");
    window.clearTimeout(refreshSnapshot.timeout);
    refreshSnapshot.timeout = window.setTimeout(() => setToast(""), 2400);
  }

  return (
    <main className="app-main" hidden={hidden}>
      <div className="page portfolio-page" id="portfolio">
        <PageHeader
          eyebrow="Portfolio"
          title="Model Portfolio"
          subtitle="Momentum × Float-Adj. Cap"
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
          <KpiCard label="Total Holdings" value={portfolioSummary?.totalHoldings ?? "—"} icon={Briefcase} tint="cream" mascotVariant="cream" mascotColor="var(--color-cream)" />
          <KpiCard label="Largest Holding" value={portfolioSummary ? `${portfolioSummary.largestHolding.ticker} ${displayPercent(portfolioSummary.largestHolding.finalWeight)}` : "—"} icon={Stack} tint="mint" mascotVariant="mint" mascotColor="var(--color-mint)" longValue />
          <KpiCard label="Top 10 Weight" value={portfolioSummary ? displayPercent(portfolioSummary.topTenWeight) : "—"} icon={ChartPieSlice} tint="pink" mascotVariant="pink" mascotColor="var(--color-pink)" />
          <KpiCard label="Invested Capital" value={portfolioSummary ? `${Math.round(portfolioSummary.investedCapital)}%` : "—"} icon={Target} tint="blue" mascotVariant="blue" mascotColor="var(--color-blue)" />
        </section>

        <section className="portfolio-summary-grid" aria-label="Portfolio allocation and constraints">
          <DashboardCard title="Sector Allocation" className="portfolio-sector-card">
            <div className="portfolio-sector-content">
              <SectorDonut sectors={portfolioSectors} />
              <ul className="portfolio-sector-legend">
                {portfolioSectors.map((sector) => (
                  <li key={sector.name}>
                    <span className="portfolio-sector-legend__name"><i style={{ "--sector-color": sector.color }} aria-hidden="true" />{sector.name}</span>
                    <strong>{Math.round(sector.value)}%</strong>
                  </li>
                ))}
              </ul>
            </div>
          </DashboardCard>

          <DashboardCard title="Stock Weight Distribution" className="portfolio-weight-card">
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
          </DashboardCard>

          <section className="dashboard-card portfolio-constraints" aria-labelledby="portfolio-constraints-title">
            <div className="dashboard-card__header"><h3 id="portfolio-constraints-title">Constraints</h3></div>
            <div className="dashboard-card__body">
              <ul className="portfolio-constraint-list">
                {portfolioConstraints.map((constraint) => {
                  const Icon = constraint.passed ? CheckCircle : WarningCircle;
                  return (
                    <li className={`portfolio-constraint${constraint.passed ? " is-passed" : " is-failed"}`} key={constraint.id}>
                      <span>{constraint.label}</span>
                      <strong>{constraint.rule}</strong>
                      <Icon size={24} weight="fill" aria-hidden="true" />
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </section>

        <DashboardCard
          title="Holdings"
          className="portfolio-holdings-card"
          action={(
            <AppButton
              variant="secondary"
              icon={DownloadSimple}
              className="portfolio-export-button"
              onClick={exportHoldingsCsv}
              disabled={isExporting}
              ariaLabel="Export the complete portfolio to CSV"
            >
              Export
            </AppButton>
          )}
        >
          <div className="portfolio-table-scroll">
            <table className="portfolio-table">
              <colgroup>
                <col className="portfolio-col-rank" />
                <col className="portfolio-col-ticker" />
                <col className="portfolio-col-sector" />
                <col className="portfolio-col-score" />
                <col className="portfolio-col-market-cap" />
                <col className="portfolio-col-raw-weight" />
                <col className="portfolio-col-final-weight" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="portfolio-heading portfolio-heading--rank"><span>#</span></th>
                  {sortableFields.slice(1).map(([key, label, className]) => (
                    <th scope="col" key={key} className={`portfolio-heading portfolio-heading--${className}`} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" aria-label={`Sort by ${label}`} onClick={() => toggleSort(key)}>
                        <span>{label}</span><SortIcon active={sort.key === key} direction={sort.direction} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleHoldings.map((holding) => (
                  <tr key={holding.ticker}>
                    <td className="portfolio-rank-cell"><span>{holding.rank}</span></td>
                    <td className="portfolio-ticker-cell">
                      <button
                        type="button"
                        className="portfolio-ticker-link"
                        onClick={() => onSelectStock?.(holding.ticker)}
                        aria-label={`Open ${holding.ticker} stock analysis`}
                      >
                        {holding.ticker}
                      </button>
                    </td>
                    <td className="portfolio-sector-cell" title={holding.sector}>{holding.sector}</td>
                    <td className="portfolio-score-cell"><span>{holding.score.toFixed(2)}</span></td>
                    <td className="portfolio-market-cap-cell">{holding.floatAdjustedMarketCap}</td>
                    <td className="portfolio-weight-value-cell">{displayPercent(holding.rawWeight)}</td>
                    <td className="portfolio-weight-value-cell is-final">{displayPercent(holding.finalWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

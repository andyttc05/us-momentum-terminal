import { useState } from "react";
import { ArrowRight, Briefcase, Funnel, Stack } from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { ChartState, DataState, Skeleton } from "./components/DataState.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { KpiCard } from "./components/KpiCard.jsx";
import { Mascot, MascotDuo } from "./components/Mascot.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { PerformanceChart } from "./components/PerformanceChart.jsx";
import { SectionHeader } from "./components/SectionHeader.jsx";
import { SectorAllocation } from "./components/SectorAllocation.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useMarket } from "./api/MarketProvider.jsx";
import { getSectionState } from "./utils/dataState.js";
import { getPortfolioState } from "./utils/portfolioState.js";

const periods = ["1Y", "3Y", "5Y", "All"];
const placeholderSeries = [
  { id: "strategy", name: "Strategy" },
  { id: "spy", name: "SPY" },
  { id: "spmo", name: "SPMO" },
];

export function OverviewPage({ onNavigate, onSelectStock, hidden = false }) {
  const [period, setPeriod] = useState("1Y");
  const { data, error, meta, status, refreshing } = useMarket();

  const snapshot = data?.overview?.snapshot;
  const performance = data?.overview?.performance?.[period];
  const topMomentum = data?.overview?.topMomentum ?? [];
  const sectorAllocation = data?.overview?.sectorAllocation ?? [];
  const portfolioState = getPortfolioState({
    portfolio: data?.portfolio,
    status,
    meta,
    error,
  });
  const portfolioCount = snapshot?.portfolioStocks;
  const portfolioTitle = portfolioCount && portfolioCount !== "—"
    ? `${portfolioCount} Holdings`
    : portfolioState.kind === "loading" ? "Portfolio loading…" : "Portfolio unavailable";
  const snapshotState = getSectionState({
    hasData: Boolean(snapshot),
    status,
    error,
    refreshing,
  });
  const performanceState = getSectionState({
    hasData: Boolean(performance?.series?.length),
    status,
    error,
    refreshing,
  });
  const momentumState = getSectionState({
    hasData: topMomentum.length > 0,
    status,
    error,
    refreshing,
  });
  const sectorState = getSectionState({
    hasData: sectorAllocation.length > 0,
    status,
    error,
    refreshing,
  });
  const legendSeries = performance?.series?.length ? performance.series : placeholderSeries;

  return (
    <main className="app-main" hidden={hidden}>
      <div className="page overview-page" id="overview">
        <PageHeader
          eyebrow="Overview"
          title="US Momentum Terminal"
          subtitle="Momentum investing for US equities"
          art={<MascotDuo creamColor="var(--color-surface)" />}
          controls={<UpdateBar dateTime={snapshot?.asOf} ariaLabel="Refresh overview" />}
        />

        <section className="overview-kpis" aria-label="Portfolio summary">
          <KpiCard loading={snapshotState === "loading"} label="Scanned Stocks" value={snapshot?.scannedStocks ?? "—"} icon={Stack} tint="cream" mascotVariant="cream" mascotColor="var(--color-cream)" />
          <KpiCard loading={snapshotState === "loading"} label="Eligible Stocks" value={snapshot?.eligibleStocks ?? "—"} icon={Funnel} tint="mint" mascotVariant="mint" mascotColor="var(--color-mint)" />
          <KpiCard loading={snapshotState === "loading"} label="Portfolio Stocks" value={snapshot?.portfolioStocks ?? "—"} icon={Briefcase} tint="pink" mascotVariant="pink" mascotColor="var(--color-pink)" />
        </section>

        <div className="overview-grid">
          <div className="overview-grid__main">
            <DashboardCard
              title="Performance"
              className="performance-card"
              action={(
                <div className="period-control" role="group" aria-label="Performance time range">
                  {periods.map((item) => (
                    <button key={item} type="button" aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</button>
                  ))}
                </div>
              )}
            >
              <div className="performance-card__toolbar">
                <div className="performance-legend" aria-label="Performance series">
                  {legendSeries.map((series) => (
                    <span className={`performance-legend__item performance-legend__item--${series.id}`} key={series.id}>
                      <i aria-hidden="true" />{series.name}
                    </span>
                  ))}
                </div>
              </div>
              {performance?.series?.length
                ? <PerformanceChart period={period} data={performance} />
                : (
                  <ChartState
                    state={performanceState}
                    title={performanceState === "error" ? "Performance unavailable" : "No performance data"}
                    detail={performanceState === "error"
                      ? "The latest chart update could not be loaded."
                      : "Verified performance history has not been published yet."}
                    className="performance-chart-state"
                  />
                )}
            </DashboardCard>

            <section className="model-banner" aria-label="Model portfolio">
              <div className="model-banner__copy">
                <p className="eyebrow">Model portfolio</p>
                <SectionHeader title={portfolioTitle} />
              </div>
              <div className="model-banner__mascot" aria-hidden="true"><Mascot size={178} variant="cream" color="var(--color-surface)" /></div>
              <AppButton variant="secondary" icon={ArrowRight} iconOnly ariaLabel="View model portfolio" className="model-banner__arrow" onClick={() => onNavigate?.("portfolio")} />
            </section>
          </div>

          <aside className="overview-grid__side" aria-label="Momentum and allocation summaries">
            <DashboardCard
              title="Top Momentum"
              className="top-momentum-card"
              action={(
                <AppButton variant="quiet" className="view-all-button" onClick={() => onNavigate?.("screener")}>
                  View All
                  <span className="view-all-button__arrow" aria-hidden="true"><ArrowRight size={14} weight="bold" /></span>
                </AppButton>
              )}
            >
              <div className="top-momentum-list">
                {topMomentum.length ? topMomentum.map((stock) => (
                  <div className="momentum-row" key={stock.ticker}>
                    <span className="momentum-row__rank">{stock.rank}</span>
                    <button
                      type="button"
                      className="momentum-row__ticker momentum-row__ticker--link"
                      onClick={() => onSelectStock?.(stock.ticker)}
                      aria-label={`Open ${stock.ticker} stock analysis`}
                    >
                      {stock.ticker}
                    </button>
                    <Sparkline values={stock.trend} label={stock.ticker} />
                    <span className="momentum-row__price">{stock.price}</span>
                    <span className="momentum-row__score">{stock.score}</span>
                  </div>
                )) : momentumState === "loading" ? Array.from({ length: 5 }, (_, index) => (
                  <div className="momentum-row momentum-row--skeleton" key={index} aria-hidden="true">
                    <Skeleton className="momentum-row__rank" width="28px" height="28px" radius="50%" />
                    <Skeleton width="42px" height="13px" />
                    <Skeleton width="76px" height="24px" />
                    <Skeleton width="62px" height="12px" style={{ justifySelf: "end" }} />
                    <Skeleton width="54px" height="27px" />
                  </div>
                )) : (
                  <DataState
                    state={momentumState}
                    title={momentumState === "error" ? "Momentum unavailable" : "No momentum leaders"}
                    detail={momentumState === "error"
                      ? "The latest rankings could not be loaded."
                      : "Ranked stocks will appear after the next verified update."}
                    className="top-momentum-state"
                  />
                )}
              </div>
            </DashboardCard>

            <DashboardCard title="Sector Allocation" className="sector-card">
              <SectorAllocation
                sectors={sectorAllocation}
                state={sectorState}
                className="sector-card__content"
              />
            </DashboardCard>
          </aside>
        </div>
      </div>
    </main>
  );
}

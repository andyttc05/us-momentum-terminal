import { useState } from "react";
import { ArrowRight, Briefcase, Funnel, Stack } from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { KpiCard } from "./components/KpiCard.jsx";
import { Mascot, MascotDuo } from "./components/Mascot.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { PerformanceChart } from "./components/PerformanceChart.jsx";
import { SectionHeader } from "./components/SectionHeader.jsx";
import { SectorDonut } from "./components/SectorDonut.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useMarket } from "./api/MarketProvider.jsx";

const periods = ["1Y", "3Y", "5Y", "All"];


export function OverviewPage({ onNavigate, onSelectStock, hidden = false }) {
  const [period, setPeriod] = useState("1Y");
  const { data } = useMarket();

  const snapshot = data?.overview?.snapshot;
  const performance = data?.overview?.performance?.[period];
  const topMomentum = data?.overview?.topMomentum ?? [];
  const sectorAllocation = data?.overview?.sectorAllocation ?? [];

  return (
    <main className="app-main" hidden={hidden}>
      <div className="page overview-page" id="overview">
        <PageHeader
          eyebrow="Overview"
          title="US Momentum Terminal"
          subtitle="Momentum investing for US equities"
          art={<MascotDuo creamColor="var(--color-surface)" trackPointer />}
          controls={<UpdateBar dateTime={snapshot?.asOf} ariaLabel="Refresh overview" />}
        />

        <section className="overview-kpis" aria-label="Portfolio summary">
          <KpiCard label="Scanned Stocks" value={snapshot?.scannedStocks ?? "—"} icon={Stack} tint="cream" mascotVariant="cream" mascotColor="var(--color-cream)" />
          <KpiCard label="Eligible Stocks" value={snapshot?.eligibleStocks ?? "—"} icon={Funnel} tint="mint" mascotVariant="mint" mascotColor="var(--color-mint)" />
          <KpiCard label="Portfolio Stocks" value={snapshot?.portfolioStocks ?? "—"} icon={Briefcase} tint="pink" mascotVariant="pink" mascotColor="var(--color-pink)" />
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
                  {(performance?.series ?? []).map((series) => (
                    <span className={`performance-legend__item performance-legend__item--${series.id}`} key={series.id}>
                      <i aria-hidden="true" />{series.name}
                    </span>
                  ))}
                </div>
              </div>
              {performance?.series?.length
                ? <PerformanceChart period={period} data={performance} />
                : <div className="performance-chart performance-chart--pending" role="status" aria-live="polite">Waiting for verified price history…</div>}
            </DashboardCard>

            <section className="model-banner" aria-label="Model portfolio">
              <div className="model-banner__copy">
                <p className="eyebrow">Model portfolio</p>
                <SectionHeader title={`${snapshot?.portfolioStocks ?? "—"} Holdings`} />
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
                {topMomentum.map((stock) => (
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
                ))}
              </div>
            </DashboardCard>

            <DashboardCard title="Sector Allocation" className="sector-card">
              <div className="sector-card__content">
                <SectorDonut sectors={sectorAllocation} />
                <ul className="sector-legend">
                  {sectorAllocation.map((sector) => (
                    <li key={sector.name}>
                      <span className="sector-legend__name"><i style={{ "--sector-color": sector.color }} aria-hidden="true" />{sector.name}</span>
                      <strong>{sector.value}%</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </DashboardCard>
          </aside>
        </div>
      </div>
    </main>
  );
}

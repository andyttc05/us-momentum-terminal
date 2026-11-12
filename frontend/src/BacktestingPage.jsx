import { useEffect, useMemo, useState } from "react";
import {
  ChartBar,
  ChartLineDown,
  Play,
  Scales,
  Stack,
} from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { KpiCard } from "./components/KpiCard.jsx";
import { Mascot, MascotDuo } from "./components/Mascot.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { useElementSize } from "./components/useElementSize.js";
import { useMarket } from "./api/MarketProvider.jsx";
import { buildDrawdownScale } from "./utils/drawdownScale.js";

const ranges = ["1Y", "3Y", "5Y", "All"];
const strategies = [
  { id: "strategy", name: "US Momentum Strategy", shortName: "Strategy", color: "#FFC83D" },
  { id: "spy", name: "SPY", color: "#69A5F5" },
  { id: "spmo", name: "SPMO", color: "#AA8BF2" },
];

function buildPath(points) {
  if (points.length < 2) return "";
  return points.reduce((path, point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const previous2 = points[index - 2] ?? previous;
    const next = points[index + 1] ?? point;
    return `${path} C ${previous.x + (point.x - previous2.x) / 6} ${previous.y + (point.y - previous2.y) / 6}, ${point.x - (next.x - previous.x) / 6} ${point.y - (next.y - previous.y) / 6}, ${point.x} ${point.y}`;
  }, "");
}

function formatPercent(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

function shiftMonths(dateString, months) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

/** Slice the daily backtest by an explicit window plus the range selector. */
function sliceWindow(block, startDate, endDate, range) {
  if (!block?.dates?.length) return null;
  const lowerBound = range === "All" ? startDate : shiftMonths(endDate, -12 * Number.parseInt(range, 10));
  const from = lowerBound > startDate ? lowerBound : startDate;

  const indexes = [];
  block.dates.forEach((date, index) => {
    if (date >= from && date <= endDate) indexes.push(index);
  });
  if (indexes.length < 2) return null;

  const pick = (array) => indexes.map((index) => array[index]);
  const strategy = pick(block.strategy);
  const base = strategy[0];
  const normalize = (array) => {
    const values = pick(array);
    const origin = values[0] || 1;
    return values.map((value) => Number(((value / origin) * 100).toFixed(4)));
  };

  const startsAtBacktestOrigin = from === block.dates[0];
  const rebased = startsAtBacktestOrigin ? pick(block.strategy) : normalize(block.strategy);
  const drawdown = [];
  let peak = rebased[0];
  rebased.forEach((value) => {
    peak = Math.max(peak, value);
    drawdown.push(Number(((value / peak - 1) * 100).toFixed(2)));
  });

  return {
    dates: pick(block.dates),
    strategy: rebased,
    spy: block.spy?.length ? normalize(block.spy) : [],
    spmo: block.spmo?.length ? normalize(block.spmo) : [],
    drawdown,
    base: 100,
  };
}

function sampleIndexes(length, maxPoints) {
  if (length <= maxPoints) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (maxPoints - 1);
  const out = new Set();
  for (let index = 0; index < maxPoints; index += 1) out.add(Math.round(index * step));
  out.add(length - 1);
  return [...out].sort((a, b) => a - b);
}

function computeMetrics(window) {
  if (!window) return { totalReturn: null, cagr: null, maxDrawdown: null, sharpe: null };
  const values = window.strategy;
  const totalReturn = (values.at(-1) / 100 - 1) * 100;
  const firstDate = new Date(`${window.dates[0]}T00:00:00`);
  const lastDate = new Date(`${window.dates.at(-1)}T00:00:00`);
  const years = Math.max((lastDate - firstDate) / (365.25 * 24 * 3600 * 1000), 1 / 252);
  const cagr = ((1 + totalReturn / 100) ** (1 / years) - 1) * 100;
  const returns = [];
  for (let index = 1; index < values.length; index += 1) {
    returns.push(values[index] / values[index - 1] - 1);
  }
  const mean = returns.reduce((total, value) => total + value, 0) / Math.max(returns.length, 1);
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : null;
  return {
    totalReturn,
    cagr,
    maxDrawdown: Math.min(...window.drawdown),
    sharpe,
  };
}

function CumulativeChart({ window, range }) {
  // Measured box: the chart draws itself at 1:1 CSS pixels so the endpoint
  // markers stay circular and the value pills keep their rounded shape.
  const [boxRef, box] = useElementSize();
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const ready = width > 0 && height > 0;

  // Phones drop the endpoint callouts so the plot can use the full width.
  const compact = width > 0 && width < 520;
  const left = compact ? 42 : 50;
  const top = compact ? 10 : 12;
  const plotWidth = Math.max(80, width - left - (compact ? 10 : 118));
  const plotHeight = Math.max(80, height - top - (compact ? 26 : 30));

  const computedSeries = strategies
    .filter((series) => window[series.id]?.length)
    .map((series) => {
      const values = window[series.id].map((value) => (value - 100));
      return { ...series, values, end: values.at(-1) };
    });

  const high = Math.max(10, ...computedSeries.flatMap(({ values }) => values));
  const low = Math.min(0, ...computedSeries.flatMap(({ values }) => values));
  // The axis is zero-based so returns read correctly; a small negative pad is
  // added only when the curve actually dips below its starting value.
  const min = low < 0 ? Math.floor(low / 10) * 10 : 0;
  const span = Math.max(high - min, 10);
  const step = Math.max(10, Math.ceil(span / 4 / 10) * 10);
  const max = Math.ceil(high / step) * step;
  const ticks = [];
  for (let value = 0; value <= max; value += step) ticks.push(value);
  if (min < 0) ticks.unshift(min);

  const pointsFor = (values) => values.map((value, index) => ({
    x: left + (index / Math.max(1, values.length - 1)) * plotWidth,
    y: top + ((max - value) / (max - min)) * plotHeight,
  }));

  const labelPositions = [];
  const seenYears = new Set();
  const minLabelGap = 58;
  window.dates.forEach((date, position) => {
    const year = date.slice(0, 4);
    if (seenYears.has(year)) return;
    const x = left + (position / Math.max(1, window.dates.length - 1)) * plotWidth;
    if (labelPositions.length && x - labelPositions.at(-1).x < minLabelGap) return;
    seenYears.add(year);
    labelPositions.push({ position, label: year, x });
  });

  const placedLabels = computedSeries
    .map((series) => ({ series, point: pointsFor(series.values).at(-1) }))
    .sort((a, b) => a.point.y - b.point.y);
  placedLabels.forEach((item, index) => {
    item.labelY = Math.max(item.point.y, index ? placedLabels[index - 1].labelY + 28 : top + 13);
  });
  const labelOverflow = (placedLabels.at(-1)?.labelY ?? 0) - (top + plotHeight - 10);
  if (labelOverflow > 0) placedLabels.forEach((item) => { item.labelY -= labelOverflow; });

  return (
    <div className="backtest-cumulative-chart">
      <div className="backtest-chart-canvas" ref={boxRef}>
      {ready && (
      <svg className="backtest-chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${range} cumulative return comparison for strategy, SPY, and SPMO`}>
        <defs>
          {computedSeries.map((series) => (
            <linearGradient id={`backtest-area-${series.id}`} key={series.id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={series.color} stopOpacity="0.015" />
            </linearGradient>
          ))}
        </defs>
        {(compact ? ticks.filter((_, index) => index % 2 === 0 || index === ticks.length - 1) : ticks).map((tick) => {
          const y = top + ((max - tick) / (max - min)) * plotHeight;
          return <g key={tick}><line x1={left} x2={left + plotWidth} y1={y} y2={y} className="backtest-gridline" /><text x={left - 9} y={y + 4} textAnchor="end" className="backtest-axis-label">{tick}%</text></g>;
        })}
        {labelPositions.map(({ label, x }, index) => {
          // Phones label every other year so the axis stays readable.
          if (compact && index % 2 !== 0 && index !== labelPositions.length - 1) return null;
          return <text key={`${label}-${index}`} x={x} y={top + plotHeight + (compact ? 18 : 25)} textAnchor="middle" className="backtest-axis-label">{label}</text>;
        })}
        {computedSeries.map((series) => {
          const points = pointsFor(series.values);
          if (!points.length) return null;
          const line = buildPath(points);
          const area = `${line} L ${points.at(-1).x} ${top + plotHeight} L ${points[0].x} ${top + plotHeight} Z`;
          return <path key={`${series.id}-area`} d={area} fill={`url(#backtest-area-${series.id})`} />;
        })}
        {computedSeries.map((series) => <path key={series.id} d={buildPath(pointsFor(series.values))} className={`backtest-series-line backtest-series-line--${series.id}`} />)}
        {!compact && placedLabels.map(({ series, point, labelY }) => (
          <g key={`${series.id}-end`}><circle cx={point.x} cy={point.y} r="4.5" className={`backtest-endpoint backtest-endpoint--${series.id}`} /><path d={`M ${point.x + 7} ${point.y} L ${point.x + 14} ${labelY}`} className={`backtest-leader backtest-leader--${series.id}`} /><rect x={point.x + 14} y={labelY - 12} width="91" height="24" rx="12" className={`backtest-value-pill backtest-value-pill--${series.id}`} /><text x={point.x + 59.5} y={labelY} dominantBaseline="central" textAnchor="middle" className="backtest-value-label">{formatPercent(series.end)}</text></g>
        ))}
      </svg>
      )}
      </div>
    </div>
  );
}

function DrawdownChart({ window, exactMin, exactIndex }) {
  const [boxRef, box] = useElementSize();
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const ready = width > 0 && height > 0;

  const values = window.drawdown;
  const scale = buildDrawdownScale(values);
  const low = scale.min;
  const left = 40;
  const top = 14;
  const plotWidth = Math.max(60, width - left - 10);
  const plotHeight = Math.max(50, height - top - 16);
  const points = values.map((value, index) => ({
    x: left + index / Math.max(1, values.length - 1) * plotWidth,
    y: top + (-value / -low) * plotHeight,
  }));
  const line = buildPath(points);
  const area = `${line} L ${left + plotWidth} ${top} L ${left} ${top} Z`;
  const minValue = typeof exactMin === "number" ? exactMin : Math.min(...values);
  const markerIndex = typeof exactIndex === "number"
    ? Math.round((exactIndex / Math.max(1, window.fullLength - 1)) * (values.length - 1))
    : values.indexOf(Math.min(...values));
  const minPoint = points[Math.min(Math.max(markerIndex, 0), points.length - 1)];
  const yMin = top + (-minValue / -low) * plotHeight;
  const troughPoint = { x: minPoint.x, y: yMin };
  const ticks = scale.ticks;

  // The callout stays an HTML overlay, so its text is never scaled by the SVG.
  const calloutGap = 11;
  const calloutY = height ? (troughPoint.y + calloutGap) / height * 100 : 0;
  const calloutX = width ? troughPoint.x / width * 100 : 0;
  const pointY = height ? troughPoint.y / height * 100 : 0;
  const connectorHeight = Math.max(0, calloutY - pointY);

  return (
    <div className="backtest-drawdown-chart">
      <div className="backtest-drawdown-canvas" ref={boxRef}>
        {ready && (
          <svg className="backtest-drawdown-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Strategy drawdown. Maximum drawdown ${formatPercent(minValue)}`}>
            <defs><linearGradient id="drawdown-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF7081" stopOpacity="0.32" /><stop offset="100%" stopColor="#FFB5C1" stopOpacity="0.08" /></linearGradient></defs>
            {ticks.map((tick) => {
              const y = top + (Math.abs(tick) / Math.abs(low)) * plotHeight;
              return <g key={tick}><line x1={left} x2={left + plotWidth} y1={y} y2={y} className="backtest-gridline" /><text x={left - 8} y={y + 4} textAnchor="end" className="backtest-axis-label">{tick}%</text></g>;
            })}
            <path d={area} fill="url(#drawdown-fill)" />
            <path d={line} className="backtest-drawdown-line" />
            <circle cx={troughPoint.x} cy={troughPoint.y} r="5" className="backtest-drawdown-point" />
          </svg>
        )}
      </div>
      <span className="backtest-drawdown-connector" style={{ left: `${calloutX}%`, top: `${pointY}%`, height: `${connectorHeight}%` }} aria-hidden="true" />
      <span className="backtest-drawdown-callout" style={{ "--callout-x": `${calloutX}%`, "--callout-y": `${calloutY}%` }}>{formatPercent(minValue)}</span>
    </div>
  );
}

export function BacktestingPage({ hidden = false }) {
  const { data, refresh } = useMarket();
  const [portfolio, setPortfolio] = useState("top100");
  const [range, setRange] = useState("All");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submittedWindow, setSubmittedWindow] = useState({ startDate: "", endDate: "" });
  const [isRunning, setIsRunning] = useState(false);
  const [toast, setToast] = useState("");

  const block = data?.backtest?.[portfolio] ?? null;
  const available = Boolean(block?.available);

  // Seed the date inputs from the verified backtest window once it arrives.
  useEffect(() => {
    if (!block?.available) return;
    setStartDate((current) => current || block.start);
    setEndDate((current) => current || block.end);
    setSubmittedWindow((current) => (current.startDate ? current : { startDate: block.start, endDate: block.end }));
  }, [block]);

  const dateError = available && startDate && endDate && startDate >= endDate ? "End date must be after start date." : "";
  const backtestWindow = useMemo(
    () => (available && submittedWindow.startDate ? sliceWindow(block, submittedWindow.startDate, submittedWindow.endDate, range) : null),
    [available, block, range, submittedWindow],
  );
  const metrics = useMemo(() => computeMetrics(backtestWindow), [backtestWindow]);

  // Charts render at most ~320 points; metrics always use the full daily series.
  const chartWindow = useMemo(() => {
    if (!backtestWindow) return null;
    const indexes = sampleIndexes(backtestWindow.dates.length, 320);
    const pick = (array) => (array?.length ? indexes.map((index) => array[index]) : []);
    return {
      dates: pick(backtestWindow.dates),
      strategy: pick(backtestWindow.strategy),
      spy: pick(backtestWindow.spy),
      spmo: pick(backtestWindow.spmo),
      drawdown: pick(backtestWindow.drawdown),
      fullLength: backtestWindow.dates.length,
    };
  }, [backtestWindow]);

  const drawdownStats = useMemo(() => {
    if (!backtestWindow) return { exactMin: null, exactIndex: null };
    let minValue = Infinity;
    let minIndex = 0;
    backtestWindow.drawdown.forEach((value, index) => {
      if (value < minValue) { minValue = value; minIndex = index; }
    });
    return { exactMin: minValue, exactIndex: minIndex };
  }, [backtestWindow]);

  // The five most recent calendar years inside the selected window. The last
  // year is still running when the window ends mid-year, so it is flagged YTD
  // instead of being presented as a completed year.
  const annualRows = useMemo(() => {
    if (!available || !backtestWindow) return [];
    const firstYear = Number(backtestWindow.dates[0].slice(0, 4));
    const lastDate = backtestWindow.dates.at(-1) ?? "";
    const lastYear = Number(lastDate.slice(0, 4));
    const partialYear = lastDate.endsWith("-12-31") ? null : lastYear;
    return (block.annual ?? [])
      .filter((row) => row.year >= firstYear && row.year <= lastYear)
      .slice(-5)
      .map((row) => ({ ...row, ytd: row.year === partialYear }));
  }, [available, block, backtestWindow]);

  function runBacktest() {
    if (dateError || isRunning) return;
    setIsRunning(true);
    window.setTimeout(() => {
      setSubmittedWindow({ startDate, endDate });
      setIsRunning(false);
      setToast("Backtest window updated");
      window.setTimeout(() => setToast(""), 2200);
    }, 650);
  }

  async function refreshPreview() {
    await refresh();
  }

  return (
    <main className="app-main" hidden={hidden}>
      <div className="page backtest-page" id="backtesting">
        <PageHeader
          eyebrow="Backtesting"
          title="Strategy Backtest"
          subtitle="Historical Performance"
          art={<MascotDuo creamColor="var(--color-surface)" />}
          controls={(
            <UpdateBar
              dateTime={block?.end ?? ""}
              ariaLabel="Refresh backtest data"
              busy={isRunning}
              onRefresh={refreshPreview}
            />
          )}
        />

        <section className="backtest-controls" aria-label="Backtest controls">
          <label className="backtest-date-field"><span>Start Date</span><input type="date" min={block?.start ?? ""} max={block?.end ?? ""} value={startDate} onInput={(event) => setStartDate(event.target.value)} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="backtest-date-field"><span>End Date</span><input type="date" min={block?.start ?? ""} max={block?.end ?? ""} value={endDate} onInput={(event) => setEndDate(event.target.value)} onChange={(event) => setEndDate(event.target.value)} /></label>
          <div className="backtest-control-separator" aria-hidden="true" />
          <div className="backtest-segmented backtest-portfolio-choice" role="group" aria-label="Portfolio selection">
            {[["top100", "Top 100"], ["top20", "Top 20%"]].map(([value, label]) => <button key={value} type="button" aria-pressed={portfolio === value} onClick={() => setPortfolio(value)}>{label}</button>)}
          </div>
          <AppButton variant="primary" icon={Play} className="backtest-run-button" disabled={Boolean(dateError) || isRunning || !available} onClick={runBacktest}>{isRunning ? "Running…" : "Run Backtest"}</AppButton>
          {dateError && <p className="backtest-date-error" role="alert">{dateError}</p>}
        </section>

        <section className="backtest-kpis" aria-label="Backtest summary">
          <KpiCard label="CAGR" value={formatPercent(metrics.cagr)} icon={ChartBar} tint="cream" mascotVariant="cream" mascotColor="var(--color-cream)" />
          <KpiCard label="Total Return" value={formatPercent(metrics.totalReturn)} icon={Stack} tint="mint" mascotVariant="mint" mascotColor="var(--color-mint)" />
          <KpiCard label="Sharpe Ratio" shortLabel="Sharpe" value={metrics.sharpe == null ? "—" : metrics.sharpe.toFixed(2)} icon={Scales} tint="pink" mascotVariant="pink" mascotColor="var(--color-pink)" />
          <KpiCard label="Maximum Drawdown" shortLabel="Max Drawdown" value={formatPercent(metrics.maxDrawdown)} icon={ChartLineDown} tint="blue" mascotVariant="blue" mascotColor="var(--color-blue)" />
        </section>

        <section className="backtest-main-grid" aria-label="Backtest results">
          <DashboardCard title="Cumulative Return" className="backtest-cumulative-card">
            <div className="backtest-chart-toolbar">
              <div className="performance-legend" aria-label="Return series">
                {strategies.map((series) => <span className={`performance-legend__item performance-legend__item--${series.id}`} key={series.id}><i aria-hidden="true" />{series.shortName ? <><span className="legend-name-full">{series.name}</span><span className="legend-name-short">{series.shortName}</span></> : series.name}</span>)}
              </div>
              <div className="period-control backtest-range-control" role="group" aria-label="Chart time range">
                {ranges.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}
              </div>
            </div>
            {chartWindow
              ? <CumulativeChart window={chartWindow} range={range} />
              : <div className="backtest-chart-pending" role="status">{available ? "Select a window inside the verified history." : "Waiting for verified price history…"}</div>}
          </DashboardCard>
          <div className="backtest-side-grid">
            <DashboardCard title="Drawdown" className="backtest-drawdown-card">
              {chartWindow
                ? <DrawdownChart window={chartWindow} exactMin={drawdownStats.exactMin} exactIndex={drawdownStats.exactIndex} />
                : <div className="backtest-chart-pending" role="status">—</div>}
            </DashboardCard>
            <DashboardCard title="Annual Return" className="backtest-annual-card">
              <table className="backtest-annual-table"><thead><tr><th>Year</th><th>Strategy</th><th>SPY</th><th>SPMO</th></tr></thead><tbody>
                {annualRows.map((row) => <tr key={row.year}><th scope="row">{row.year}{row.ytd && <span className="backtest-annual-ytd"> YTD</span>}</th>{["strategy", "spy", "spmo"].map((key) => { const value = row[key]; if (value === null || value === undefined) return <td className="is-missing" key={key}>—</td>; return <td className={value < 0 ? "is-negative" : "is-positive"} key={key}>{formatPercent(value)}</td>; })}</tr>)}
                {!annualRows.length && <tr><td colSpan="4" className="backtest-annual-empty">No completed calendar year in this window.</td></tr>}
              </tbody></table>
            </DashboardCard>
          </div>
        </section>
      </div>
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

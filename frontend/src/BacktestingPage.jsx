import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bank,
  CalendarBlank,
  CaretDown,
  ChartBar,
  Coins,
  Play,
  Scales,
  SlidersHorizontal,
  Stack,
  TrendUp,
} from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { ChartState, DataState, Skeleton, TableSkeletonRows, TableStateRow } from "./components/DataState.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { ExportMenu } from "./components/ExportMenu.jsx";
import { KpiCard } from "./components/KpiCard.jsx";
import { MascotDuo } from "./components/Mascot.jsx";
import { PageHeader } from "./components/PageHeader.jsx";
import { PortfolioEvolution } from "./components/PortfolioEvolution.jsx";
import { useChartTooltipSize } from "./components/useChartTooltipSize.js";
import {
  CurrencyInput,
  Dropdown,
  InfoTooltip,
  SettingsCard,
  SettingsRow,
  Toggle,
} from "./components/SettingsControls.jsx";
import { Toast } from "./components/Toast.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useElementSize } from "./components/useElementSize.js";
import { useMarket } from "./api/MarketProvider.jsx";
import { useUniverse } from "./api/UniverseProvider.jsx";
import {
  backtestFilename,
  buildBacktestExportData,
  downloadBacktestCsv,
} from "./utils/backtestExport.js";
import { computeWindowMetrics, formatBacktestDuration } from "./utils/backtestMetrics.js";
import {
  analyzeDrawdown,
  applyInflationAdjustment,
  buildBacktestAnalysis,
  getBacktestAvailability,
  sliceAccountSeries,
} from "./utils/backtestReport.js";
import { buildDrawdownScale } from "./utils/drawdownScale.js";
import { resolveYearLabelPositions } from "./utils/yearAxis.js";
import {
  createCalendarScale,
  visibleYearTicks,
  yearLabelGap,
} from "./utils/calendarAxis.js";
import { getSectionState } from "./utils/dataState.js";
import { downloadWorkbookFile } from "./utils/exportFiles.js";
import {
  CHART_TOOLTIP_GAP,
  CHART_TOOLTIP_MARGIN,
  fitTooltipWidth,
  nearestObservationIndex,
  placePriceTooltip,
  sideForMovement,
} from "./utils/priceTooltip.js";
import {
  DEFAULT_REBALANCE_FREQUENCY,
  REBALANCE_OPTIONS,
  rebalanceLabel,
  rebalanceSummaryLabel,
} from "./utils/rebalanceFrequency.js";
import { UNIVERSE_OPTIONS } from "./utils/universeState.js";

const RANGES = ["1Y", "3Y", "5Y", "All"];
// The two cumulative-chart views are different measurements, not skins:
// "value" plots the cashflow-inclusive account balance, "return" plots the
// flow-neutral unitized TWR.
const CHART_VIEWS = [
  { id: "value", label: "Portfolio Value" },
  { id: "return", label: "Cumulative Return" },
];
const SERIES = [
  { id: "strategy", name: "Strategy", color: "#FFC83D" },
  { id: "spy", name: "SPY", color: "#69A5F5" },
  { id: "spmo", name: "SPMO", color: "#AA8BF2" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_TOOLTIP = { width: 272, height: 116 };
const PERIOD_TOOLTIP = { width: 196, height: 82 };

const DEFAULT_CONFIG = {
  startDate: "",
  endDate: "",
  initialCapital: "10000",
  cashflowEnabled: true,
  contributionAmount: "1000",
  contributionFrequency: "monthly",
  cashflowDirection: "inflow",
  rebalanceFrequency: DEFAULT_REBALANCE_FREQUENCY,
  reinvestDividends: true,
  inflationAdjusted: false,
  includeYtd: true,
};

function backtestRunKey(config) {
  if (!config) return "";
  return [
    config.portfolio,
    config.startDate,
    config.endDate,
    config.rebalanceFrequency,
  ].join("|");
}

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

function formatMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTooltipMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return formatMoney(value);
}

function formatAxisMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) >= 100_000 ? 0 : 1,
  }).format(value);
}

function formatDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  if (!match) return "—";
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

function valueTone(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function shiftMonths(dateString, months) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

/**
 * Slice an existing daily NAV and benchmark series. Rebasing affects only the
 * visible chart window; the submitted backtest and its metrics stay unchanged.
 */
function buildWindow(block, startDate, endDate, range = "All", reinvestDividends = true) {
  if (!block?.available || !block.dates?.length || !startDate || !endDate) return null;
  const lowerBound = range === "All"
    ? startDate
    : shiftMonths(endDate, -12 * Number.parseInt(range, 10));
  const from = lowerBound > startDate ? lowerBound : startDate;
  const indexes = [];
  block.dates.forEach((date, index) => {
    if (date >= from && date <= endDate) indexes.push(index);
  });
  if (indexes.length < 2) return null;

  const sourceStrategy = reinvestDividends ? block.strategy : block.priceStrategy;
  const sourceSpy = reinvestDividends ? block.spy : block.priceSpy;
  const sourceSpmo = reinvestDividends ? block.spmo : block.priceSpmo;
  if (!sourceStrategy?.length || !sourceSpy?.length || !sourceSpmo?.length) return null;
  const pick = (values) => indexes.map((index) => values[index]);
  const dates = pick(block.dates);
  const startsAtBacktestOrigin = dates[0] === block.dates[0];
  const pickedStrategy = pick(sourceStrategy);
  const strategy = startsAtBacktestOrigin
    ? pickedStrategy
    : pickedStrategy.map((value) => value / pickedStrategy[0] * 100);
  const normalizeBenchmark = (values) => {
    if (!values?.length) return [];
    const picked = pick(values);
    return picked.map((value) => value / picked[0] * 100);
  };
  const spy = normalizeBenchmark(sourceSpy);
  const spmo = normalizeBenchmark(sourceSpmo);
  const drawdown = [];
  let peak = strategy[0];
  strategy.forEach((value) => {
    peak = Math.max(peak, value);
    drawdown.push((value / peak - 1) * 100);
  });

  return {
    dates,
    strategy,
    spy,
    spmo,
    drawdown,
    reinvestDividends,
    startsAtBacktestOrigin,
    fullWindow: dates[0] === block.dates[0] && dates.at(-1) === block.dates.at(-1),
  };
}

function cumulativeScale(high, low) {
  const span = Math.max(high - low, 10);
  const magnitude = 10 ** Math.floor(Math.log10(span / 5));
  const normalized = span / 5 / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const max = Math.ceil(Math.max(high, step) / step) * step;
  const min = low < 0 ? Math.floor(low / 10) * 10 : 0;
  const ticks = min < 0 ? [min] : [];
  for (let value = 0; value <= max + step * 0.01; value += step) ticks.push(value);
  return { min, max, ticks };
}

function wealthPosition(value, scale, top, plotHeight, logScale) {
  if (!logScale) {
    return top + (scale.max - value) / (scale.max - scale.min) * plotHeight;
  }
  const minimum = Math.log10(1 + scale.min / 100);
  const maximum = Math.log10(1 + scale.max / 100);
  return top + (maximum - Math.log10(1 + value / 100)) / (maximum - minimum) * plotHeight;
}

/**
 * Dollar ticks for the account-balance view. The step is chosen so the plot
 * keeps roughly four gridlines whatever the account size, and the axis never
 * starts below zero because an account balance cannot be negative.
 */
function moneyScale(low, high) {
  const span = Math.max(high - low, 1);
  const magnitude = 10 ** Math.floor(Math.log10(span / 4));
  const normalized = span / 4 / magnitude;
  const step = (
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  ) * magnitude;
  const max = Math.ceil(high / step) * step;
  const min = Math.max(0, Math.floor(low / step) * step);
  const ticks = [];
  for (let value = min; value <= max + step * 0.01; value += step) ticks.push(value);
  return { min, max: Math.max(max, min + step), ticks: ticks.length ? ticks : [min] };
}

function valuePosition(value, scale, top, plotHeight, logScale) {
  if (!logScale) {
    return top + (scale.max - value) / (scale.max - scale.min) * plotHeight;
  }
  // A dollar axis can be logged directly; the floor keeps a depleted account
  // (balance 0) on the chart instead of taking log(0).
  const minimum = Math.max(scale.min, 1);
  const maximum = Math.max(scale.max, minimum * 10);
  const clamped = Math.max(value, minimum);
  return top
    + (Math.log10(maximum) - Math.log10(clamped))
    / (Math.log10(maximum) - Math.log10(minimum)) * plotHeight;
}

function CumulativeTooltip({ dates, index, width, seriesValues }) {
  return (
    <div className="backtest-chart-tooltip" role="tooltip" style={{ width }}>
      <span className="backtest-chart-tooltip__date">{formatDate(dates[index])}</span>
      {SERIES.map((series) => {
        const values = seriesValues?.[series.id];
        const portfolioValue = values?.values?.[index];
        const cumulativeReturn = values?.returns?.[index];
        return (
          <span className="backtest-chart-tooltip__row" key={series.id}>
            <i style={{ "--series-color": series.color }} aria-hidden="true" />
            <span className="backtest-chart-tooltip__name">{series.name}</span>
            <strong className="backtest-chart-tooltip__portfolio">
              {formatTooltipMoney(portfolioValue)}
            </strong>
            <strong className={`backtest-chart-tooltip__return is-${valueTone(cumulativeReturn)}`}>
              {formatPercent(cumulativeReturn)}
            </strong>
          </span>
        );
      })}
    </div>
  );
}
function LogScaleToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="backtest-log-toggle"
      onClick={() => onChange(!checked)}
    >
      <span>Log Scale</span>
      <span className="backtest-switch" aria-hidden="true"><i /></span>
    </button>
  );
}

function CumulativeChart({ dates, range, view, logScale, seriesValues, onLogUnavailable }) {
  const [boxRef, box] = useElementSize();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [tooltipSide, setTooltipSide] = useState(null);
  const [tooltipRef, tooltipSize] = useChartTooltipSize();
  const movementOriginX = useRef(Number.NaN);
  const tooltipSideRef = useRef(null);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const ready = width > 0 && height > 0;
  const compact = width > 0 && width < 560;
  // The dollar view needs a wider label gutter because "$1.24M" is longer
  // than "+363.7%".
  const isPercent = view !== "value";
  const left = compact ? 42 : 54;
  const top = 30;
  const labelGutter = (compact ? 82 : 126) + (isPercent ? 0 : 22);
  const plotWidth = Math.max(80, width - left - labelGutter);
  const plotHeight = Math.max(80, height - top - (compact ? 30 : 34));

  const computedSeries = SERIES
    .map((series) => {
      const entry = seriesValues?.[series.id];
      const values = isPercent ? entry?.returns : entry?.values;
      return { ...series, values: Array.isArray(values) ? values : [] };
    })
    .filter((series) => series.values.length === dates.length);

  useEffect(() => {
    setSelectedIndex(null);
    setTooltipSide(null);
    movementOriginX.current = Number.NaN;
    tooltipSideRef.current = null;
  }, [range, view, dates.length]);

  const allValues = computedSeries
    .flatMap((series) => series.values)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const high = isPercent ? Math.max(10, ...allValues) : Math.max(0, ...allValues);
  const low = isPercent ? Math.min(0, ...allValues) : Math.min(high, ...allValues);
  const scale = isPercent ? cumulativeScale(high, low) : moneyScale(low, high);
  const logAvailable = allValues.length > 0
    && allValues.every((value) => (isPercent ? value > -100 : value > 0));
  const renderedLogScale = logScale && logAvailable;
  const yForValue = (value) => (
    isPercent
      ? wealthPosition(value, scale, top, plotHeight, renderedLogScale)
      : valuePosition(value, scale, top, plotHeight, renderedLogScale)
  );
  const axisLabel = (tick) => (isPercent ? `${tick}%` : formatAxisMoney(tick));
  useEffect(() => {
    if (logScale && !logAvailable) onLogUnavailable?.();
  }, [logAvailable, logScale, onLogUnavailable]);
  const negativeTickTooClose = scale.min < 0
    && Math.abs(scale.min) / (scale.max - scale.min) * plotHeight < 18;
  const pointsFor = (values) => values.map((value, index) => ({
    x: left + index / Math.max(1, values.length - 1) * plotWidth,
    y: yForValue(value),
  }));

  // Same collision-safe treatment as the drawdown chart, with this chart's own
  // spacing. The helper clamps to the plot edges, so labels need no extra clamp.
  const labelPositions = resolveYearLabelPositions(
    dates,
    left,
    plotWidth,
    compact ? 66 : 48,
  );
  const pillWidth = compact ? (isPercent ? 70 : 84) : (isPercent ? 91 : 112);
  const pillOffset = compact ? 9 : 14;
  const pillCenter = pillOffset + pillWidth / 2;
  const endLabels = computedSeries
    .map((series) => ({ series, point: pointsFor(series.values).at(-1) }))
    .sort((a, b) => a.point.y - b.point.y);
  endLabels.forEach((item, index) => {
    item.labelY = Math.max(
      item.point.y,
      index ? endLabels[index - 1].labelY + (compact ? 24 : 28) : top + 12,
    );
  });
  const lastLabel = endLabels.at(-1);
  if (lastLabel?.labelY > top + plotHeight - 12) {
    const overflow = lastLabel.labelY - (top + plotHeight - 12);
    endLabels.forEach((item) => { item.labelY -= overflow; });
  }

  const leadValues = computedSeries[0]?.values ?? [];
  const selectedPoint = selectedIndex == null || !leadValues.length
    ? null
    : pointsFor(leadValues)[selectedIndex];
  const labelBoundary = left + plotWidth + pillOffset;
  const tooltipGap = compact ? 14 : CHART_TOOLTIP_GAP;
  const tooltipMargin = compact ? 8 : CHART_TOOLTIP_MARGIN;
  const tooltipWidth = compact
    // A phone chart is narrower than two tooltip widths, so the card keeps a
    // readable width and is nudged vertically away from the crosshair instead
    // of being squeezed until the columns collide.
    ? Math.min(208, width - tooltipMargin * 2)
    : fitTooltipWidth({
      containerWidth: width,
      preferredWidth: CHART_TOOLTIP.width,
      gap: tooltipGap,
      margin: tooltipMargin,
    });
  const placement = selectedPoint
    ? placePriceTooltip({
      anchorX: selectedPoint.x,
      anchorY: selectedPoint.y,
      preferredSide: tooltipSide,
      containerWidth: width,
      containerHeight: height,
      rightBoundary: labelBoundary,
      tooltipWidth: tooltipSize?.width ?? tooltipWidth,
      tooltipHeight: tooltipSize?.height ?? CHART_TOOLTIP.height,
      gap: tooltipGap,
      margin: tooltipMargin,
    })
    : null;
  const tooltipHeight = tooltipSize?.height ?? CHART_TOOLTIP.height;
  const coversCrosshair = Boolean(
    compact
    && placement
    && selectedPoint
    && placement.x <= selectedPoint.x
    && placement.x + (tooltipSize?.width ?? tooltipWidth) >= selectedPoint.x,
  );
  // Keep the vertical crosshair visible: on a phone the card is wider than one
  // side of the plot, so it sits above or below the hovered point instead.
  const tooltipTop = !placement
    ? null
    : !coversCrosshair
      ? placement.y
      : selectedPoint.y > top + plotHeight / 2
        ? Math.max(tooltipMargin, selectedPoint.y - tooltipHeight - 16)
        : Math.min(height - tooltipHeight - tooltipMargin, selectedPoint.y + 16);

  function selectAt(clientX) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !leadValues.length) return;
    const x = Math.min(Math.max(clientX - rect.left, left), left + plotWidth);
    const nextSide = sideForMovement({
      pointerX: x,
      movementOriginX: movementOriginX.current,
      currentSide: tooltipSideRef.current,
    });
    movementOriginX.current = nextSide.movementOriginX;
    tooltipSideRef.current = nextSide.side;
    setTooltipSide(nextSide.side);
    setSelectedIndex(nearestObservationIndex(pointsFor(leadValues), x));
  }

  function handleLeave(event) {
    if (event.pointerType === "touch" || event.pointerType === "pen") return;
    setSelectedIndex(null);
    movementOriginX.current = Number.NaN;
    tooltipSideRef.current = null;
    setTooltipSide(null);
  }

  return (
    <div className="backtest-chart-frame" ref={boxRef}>
      {ready && computedSeries.length > 0 && (
        <svg
          className="backtest-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={isPercent
            ? `${range} cumulative return comparison for strategy, SPY and SPMO`
            : `${range} account balance comparison for strategy, SPY and SPMO`}
          onPointerMove={(event) => {
            if (event.pointerType !== "touch" && event.pointerType !== "pen") selectAt(event.clientX);
          }}
          onPointerLeave={handleLeave}
          onPointerDown={(event) => selectAt(event.clientX)}
        >
          <defs>
            {computedSeries.map((series) => (
              <linearGradient id={`backtest-area-${series.id}`} key={series.id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series.color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={series.color} stopOpacity="0.015" />
              </linearGradient>
            ))}
          </defs>
          {scale.ticks.filter((tick) => !(negativeTickTooClose && tick === scale.min)).map((tick) => {
            const y = yForValue(tick);
            return (
              <g key={tick}>
                <line x1={left} x2={left + plotWidth} y1={y} y2={y} className="backtest-gridline" />
                <text x={left - 9} y={y + 4} textAnchor="end" className="backtest-axis-label">{axisLabel(tick)}</text>
              </g>
            );
          })}
          {labelPositions.map(({ year, x }) => (
            <text
              key={year}
              x={x}
              y={top + plotHeight + 25}
              textAnchor="middle"
              className="backtest-axis-label"
            >{year}</text>
          ))}
          {computedSeries.map((series) => {
            const points = pointsFor(series.values);
            const line = buildPath(points);
            const area = `${line} L ${points.at(-1).x} ${top + plotHeight} L ${points[0].x} ${top + plotHeight} Z`;
            return <path key={`${series.id}-area`} d={area} fill={`url(#backtest-area-${series.id})`} />;
          })}
          {computedSeries.map((series) => (
            <path key={series.id} d={buildPath(pointsFor(series.values))} className={`backtest-series-line backtest-series-line--${series.id}`} />
          ))}
          {selectedPoint && (
            <g data-testid="backtest-cumulative-selection">
              <line x1={selectedPoint.x} x2={selectedPoint.x} y1={top} y2={top + plotHeight} className="backtest-crosshair" />
              {computedSeries.map((series) => {
                const point = pointsFor(series.values)[selectedIndex];
                return <circle key={series.id} cx={point.x} cy={point.y} r="4.5" className={`backtest-hover-point backtest-hover-point--${series.id}`} />;
              })}
            </g>
          )}
          {endLabels.map(({ series, point, labelY }) => (
            <g key={`${series.id}-end`} data-testid={`backtest-final-label-${series.id}`}>
              <circle cx={point.x} cy={point.y} r="4.5" className={`backtest-endpoint backtest-endpoint--${series.id}`} />
              <path d={`M ${point.x + 7} ${point.y} L ${point.x + pillOffset} ${labelY}`} className={`backtest-leader backtest-leader--${series.id}`} />
              <rect
                x={point.x + pillOffset}
                y={labelY - (compact ? 10 : 12)}
                width={pillWidth}
                height={compact ? 20 : 24}
                rx={compact ? 10 : 12}
                className={`backtest-value-pill backtest-value-pill--${series.id}`}
              />
              <text
                x={point.x + pillCenter}
                y={labelY}
                dominantBaseline="central"
                textAnchor="middle"
                className={`backtest-value-label${compact ? " backtest-value-label--compact" : ""}`}
              >{isPercent ? formatPercent(series.values.at(-1)) : formatTooltipMoney(series.values.at(-1))}</text>
            </g>
          ))}
        </svg>
      )}
      {ready && selectedPoint && (
        <div
          className="backtest-floating-tooltip"
          ref={tooltipRef}
          style={{ left: placement.x, top: tooltipTop }}
          data-testid="backtest-cumulative-tooltip"
        >
          <CumulativeTooltip
            dates={dates}
            index={selectedIndex}
            width={tooltipWidth}
            seriesValues={seriesValues}
          />
        </div>
      )}
    </div>
  );
}
function DrawdownChart({ dates, values, basis }) {
  const [boxRef, box] = useElementSize();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [tooltipRef, tooltipSize] = useChartTooltipSize();
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const ready = width > 0 && height > 0;
  const compact = width > 0 && width < 560;
  const left = compact ? 42 : 54;
  const top = 30;
  const plotWidth = Math.max(80, width - left - 18);
  const plotHeight = Math.max(90, height - top - 34);
  const scale = buildDrawdownScale(values);
  const low = Math.min(scale.min, -1);
  // Calendar-time x-axis: every point sits at its real date, each calendar year
  // owns one equal-width segment, and a partial first year simply starts part
  // way into its segment. Falls back to index spacing only if no date parses.
  const axis = createCalendarScale(dates, left, plotWidth);
  let previousX = axis ? axis.innerLeft : left;
  const points = values.map((value, index) => {
    const x = axis?.xForDate(dates[index]) ?? previousX;
    previousX = x;
    return {
      x,
      y: top + Math.abs(value) / Math.abs(low) * plotHeight,
    };
  });
  const line = buildPath(points);
  const area = points.length
    ? `${line} L ${points.at(-1).x} ${top} L ${points[0].x} ${top} Z`
    : "";
  let maxIndex = 0;
  values.forEach((value, index) => {
    if (value < values[maxIndex]) maxIndex = index;
  });
  const selectedPoint = selectedIndex == null ? null : points[selectedIndex];
  const tooltipWidth = fitTooltipWidth({
    containerWidth: width,
    preferredWidth: compact ? 182 : PERIOD_TOOLTIP.width,
  });
  const placement = selectedPoint
    ? placePriceTooltip({
      anchorX: selectedPoint.x,
      anchorY: selectedPoint.y,
      preferredSide: selectedPoint.x > width / 2 ? "left" : "right",
      containerWidth: width,
      containerHeight: height,
      tooltipWidth: tooltipSize?.width ?? tooltipWidth,
      tooltipHeight: tooltipSize?.height ?? PERIOD_TOOLTIP.height,
    })
    : null;
  // One tick per calendar year, evenly spaced by construction. Labels only thin
  // out on charts too narrow to hold them; surviving labels keep their grid.
  const yearTicks = axis
    ? visibleYearTicks(axis.ticks, axis.segmentWidth, yearLabelGap(compact))
    : [];

  useEffect(() => {
    setSelectedIndex(null);
  }, [dates.length, dates[0], basis]);

  function selectAt(clientX) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(Math.max(clientX - rect.left, left), left + plotWidth);
    setSelectedIndex(nearestObservationIndex(points, x));
  }

  return (
    <div className="backtest-chart-frame backtest-drawdown-frame" ref={boxRef}>
      <span className="backtest-axis-caption">
        {basis === "account" ? "Account balance drawdown (%)" : "Investment drawdown (%)"}
      </span>
      {ready && (
        <svg
          className="backtest-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${basis === "account" ? "Account balance" : "Investment"} drawdown, maximum ${formatPercent(values[maxIndex])} on ${formatDate(dates[maxIndex])}`}
          onPointerMove={(event) => {
            if (event.pointerType !== "touch" && event.pointerType !== "pen") selectAt(event.clientX);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch" && event.pointerType !== "pen") setSelectedIndex(null);
          }}
          onPointerDown={(event) => selectAt(event.clientX)}
        >
          <defs>
            <linearGradient id="drawdown-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF7081" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#FFB5C1" stopOpacity="0.06" />
            </linearGradient>
          </defs>
          {scale.ticks.map((tick) => {
            const y = top + Math.abs(tick) / Math.abs(low) * plotHeight;
            return (
              <g key={tick}>
                <line x1={left} x2={left + plotWidth} y1={y} y2={y} className={tick === 0 ? "backtest-zero-line" : "backtest-gridline"} />
                <text x={left - 9} y={y + 4} textAnchor="end" className="backtest-axis-label">{tick}%</text>
              </g>
            );
          })}
          {yearTicks.map(({ year, x }) => (
            <text
              key={year}
              x={x}
              y={top + plotHeight + 25}
              textAnchor="middle"
              className="backtest-axis-label"
            >{year}</text>
          ))}
          <path d={area} fill="url(#drawdown-fill)" />
          <path d={line} className="backtest-drawdown-line" />
          {selectedPoint && (
            <g data-testid="backtest-drawdown-selection">
              <line x1={selectedPoint.x} x2={selectedPoint.x} y1={top} y2={top + plotHeight} className="backtest-crosshair" />
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r="4.5" className="backtest-hover-point backtest-hover-point--drawdown" />
            </g>
          )}
        </svg>
      )}
      {ready && selectedPoint && (
        <div className="backtest-floating-tooltip" style={{ left: placement.x, top: placement.y }} data-testid="backtest-drawdown-tooltip">
          <div
            className="backtest-chart-tooltip backtest-chart-tooltip--compact"
            role="tooltip"
            ref={tooltipRef}
            style={{ width: tooltipWidth }}
          >
            <span className="backtest-chart-tooltip__date">{formatDate(dates[selectedIndex])}</span>
            <strong className="backtest-chart-tooltip__drawdown">{formatPercent(values[selectedIndex], 2)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
function AnnualReturnTable({ rows = [], includeYtd, state = "ready" }) {
  const visibleRows = rows.filter((row) => includeYtd || !row.ytd);
  return (
    <DashboardCard title="Annual Return" className="backtest-annual-card">
      <div className="backtest-table-scroll">
        <table className="backtest-annual-table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="backtest-annual-series backtest-annual-series--strategy"><span><i aria-hidden="true" />Strategy</span></th>
              <th className="backtest-annual-series backtest-annual-series--spy"><span><i aria-hidden="true" />SPY</span></th>
              <th className="backtest-annual-series backtest-annual-series--spmo"><span><i aria-hidden="true" />SPMO</span></th>
            </tr>
          </thead>
          <tbody>
            {state === "loading" ? (
              <TableSkeletonRows columns={4} rows={6} />
            ) : state !== "ready" ? (
              <TableStateRow
                columns={4}
                state={state}
                title={state === "error" ? "Annual returns unavailable" : "No annual returns"}
                detail={state === "error"
                  ? "The latest calendar-year results could not be loaded."
                  : "No calendar-year returns were published for this window."}
              />
            ) : visibleRows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.key}
                  {row.partialStart && <span className="backtest-year-tag">Partial</span>}
                  {row.ytd && <span className="backtest-year-tag">YTD</span>}
                </th>
                {SERIES.map((series) => {
                  const value = row[series.id];
                  return (
                    <td key={series.id} className={`backtest-annual-series backtest-annual-series--${series.id} ${valueTone(value)}`}>
                      {formatPercent(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {state === "ready" && !visibleRows.length && (
              <tr><td colSpan="4" className="backtest-table-empty">No calendar-year returns in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="backtest-table-note">
        Flow-neutral time-weighted returns: deposits and withdrawals are excluded.
      </p>
    </DashboardCard>
  );
}

function MonthlyReturnTable({ rows = [], state = "ready" }) {
  const visibleRows = rows.slice(-12).reverse();
  return (
    <DashboardCard title="Monthly Performance" className="backtest-annual-card backtest-monthly-card">
      <div className="backtest-table-scroll">
        <table className="backtest-annual-table backtest-monthly-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="backtest-annual-series backtest-annual-series--strategy"><span><i aria-hidden="true" />Strategy</span></th>
              <th className="backtest-annual-series backtest-annual-series--spy"><span><i aria-hidden="true" />SPY</span></th>
              <th className="backtest-annual-series backtest-annual-series--spmo"><span><i aria-hidden="true" />SPMO</span></th>
            </tr>
          </thead>
          <tbody>
            {state === "loading" ? (
              <TableSkeletonRows columns={4} rows={6} />
            ) : state !== "ready" ? (
              <TableStateRow
                columns={4}
                state={state}
                title={state === "error" ? "Monthly returns unavailable" : "No monthly returns"}
                detail={state === "error"
                  ? "The latest monthly results could not be loaded."
                  : "No monthly returns were published for this window."}
              />
            ) : visibleRows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {SERIES.map((series) => {
                  const value = row[series.id];
                  return (
                    <td key={series.id} className={`backtest-annual-series backtest-annual-series--${series.id} ${valueTone(value)}`}>
                      {formatPercent(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {state === "ready" && !visibleRows.length && (
              <tr><td colSpan="4" className="backtest-table-empty">No completed monthly returns in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="backtest-table-note">
        Flow-neutral time-weighted returns: deposits and withdrawals are excluded.
      </p>
    </DashboardCard>
  );
}

function PerformanceSummary({ report, reportWindow, metrics, config, state = "ready" }) {
  const cashflowDirection = config?.cashflowDirection === "outflow" ? "outflow" : "inflow";
  const cashflowLabel = config?.cashflowEnabled
    ? cashflowDirection === "outflow" ? "Actual Withdrawals" : "Total Cash Inflows"
    : "Net Cashflows";
  const cashflowValue = report
    ? formatMoney(config?.cashflowEnabled
      ? cashflowDirection === "outflow" ? report.actualOutflows : report.totalInflows
      : report.netCashflows)
    : "—";
  const unpaidDetail = report?.unpaidOutflows > 0
    ? `${formatMoney(report.requestedOutflows)} requested · ${formatMoney(report.unpaidOutflows)} unpaid`
    : null;
  const settings = [
    { label: "Initial Capital", value: report ? formatMoney(report.initialCapital) : "—", icon: Bank },
    { label: "Reinvest Dividends", value: config ? (config.reinvestDividends ? "Yes" : "No") : "—", icon: TrendUp },
    { label: "Inflation Adjusted", value: config ? (config.inflationAdjusted ? "Yes" : "No") : "—", icon: ChartBar },
    {
      label: "Rebalancing",
      value: config ? rebalanceLabel(config.rebalanceFrequency) : "—",
      icon: Scales,
    },
  ];
  const performanceMetrics = [
    {
      label: "Duration",
      value: formatBacktestDuration(reportWindow?.dates?.[0], reportWindow?.dates?.at(-1)),
      tip: "Completed calendar months between the first and last effective backtest observations.",
    },
    {
      label: "CAGR",
      value: formatPercent(metrics?.cagr),
      tone: valueTone(metrics?.cagr),
      tip: "Annualised strategy NAV growth over the effective dates. External contributions are excluded, so the result remains cashflow-safe.",
    },
    {
      label: "Sharpe Ratio",
      value: typeof metrics?.sharpe === "number" && Number.isFinite(metrics.sharpe)
        ? metrics.sharpe.toFixed(2)
        : "—",
      tip: "Annualised daily excess return using the existing 0% risk-free-rate assumption.",
    },
    {
      label: "Time-Weighted Return",
      value: formatPercent(report?.timeWeightedReturnPct, 2),
      tone: valueTone(report?.timeWeightedReturnPct),
      tip: "Daily portfolio growth linked across external cashflows. Cashflow timing does not change this return.",
    },
    {
      label: "Money-Weighted Return / XIRR",
      value: formatPercent(report?.moneyWeightedReturnPct, 2),
      tone: valueTone(report?.moneyWeightedReturnPct),
      tip: "The annualised rate that makes the dated initial investment, cashflows and ending account value net to zero.",
    },
    {
      label: "Net Profit / Loss",
      value: report ? formatMoney(report.netProfitLoss) : "—",
      tone: valueTone(report?.netProfitLoss),
      tip: "Ending balance plus actual withdrawals, minus initial capital and actual deposits. Unpaid withdrawals are excluded because they never left the account.",
    },
    {
      label: "Investment Max Drawdown",
      value: formatPercent(metrics?.maxDrawdown),
      tone: valueTone(metrics?.maxDrawdown),
      tip: "Peak-to-trough decline of the unitized total-return NAV. Deposits and withdrawals cannot create or mask this loss.",
    },
    {
      label: "Account Max Drawdown",
      value: formatPercent(report?.accountDrawdown?.maxDrawdown),
      tone: valueTone(report?.accountDrawdown?.maxDrawdown),
      tip: "Peak-to-trough decline of the actual account balance, including executed withdrawals. This is a cashflow view, not a market-loss measure.",
    },
    {
      label: "vs. SPY (Total Return)",
      value: report ? `${formatPercent(report.relativeToSpyPct)} pp` : "—",
      tone: valueTone(report?.relativeToSpyPct),
      tip: "Time-weighted strategy return minus the matched-date SPY return. Both sides use the selected nominal or inflation-adjusted basis.",
    },
  ];
  return (
    <DashboardCard title="Performance Summary" className="backtest-summary-card">
      <div className="backtest-summary-top">
        <div className="backtest-summary-primary">
          <div className="backtest-summary-tile">
            <span className="backtest-summary-tile__label"><Stack size={18} aria-hidden="true" />Final Portfolio Value</span>
            <strong>
              {state === "loading"
                ? <Skeleton width="76%" height="0.65em" />
                : report ? formatMoney(report.finalValue) : "—"}
            </strong>
          </div>
          <div className="backtest-summary-tile">
            <span className="backtest-summary-tile__label"><Coins size={18} aria-hidden="true" />{cashflowLabel}</span>
            <strong>
              {state === "loading"
                ? <Skeleton width="64%" height="0.65em" />
                : cashflowValue}
            </strong>
            {state === "ready" && unpaidDetail && (
              <span className="backtest-summary-tile__detail">{unpaidDetail}</span>
            )}
          </div>
        </div>
        <div className="backtest-summary-settings" aria-label="Investment settings">
          {settings.map(({ label, value, icon: Icon }) => (
            <div className="backtest-summary-setting" key={label}>
              <span><Icon size={16} aria-hidden="true" />{label}</span>
              <strong>{state === "loading" ? <Skeleton width="58px" height="11px" /> : value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="backtest-return-metrics" aria-label="Performance metrics">
        {performanceMetrics.map(({ label, value, tone = "", tip }) => (
          <div className="backtest-metric-tile" key={label}>
            <span className="backtest-metric-tile__label">
              {label}
              <InfoTooltip label={label}>{tip}</InfoTooltip>
            </span>
            <strong className={tone ? `is-${tone}` : undefined}>
              {state === "loading"
                ? <Skeleton width="72px" height="16px" />
                : value}
            </strong>
          </div>
        ))}
      </div>
      {state !== "ready" && state !== "loading" && (
        <DataState
          state={state}
          title="Performance summary unavailable"
          detail="The latest validated backtest results are not available."
          className="backtest-summary-state"
        />
      )}
    </DashboardCard>
  );
}

function RiskAnalysis({ metrics, state = "ready" }) {
  const spy = metrics?.benchmarkRelative?.spy;
  const spmo = metrics?.benchmarkRelative?.spmo;
  const ratio = (value, digits = 2) => (
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"
  );
  const analysisMetrics = [
    {
      label: "Annualized Volatility",
      value: formatPercent(metrics?.annualizedVolatility),
      tip: "Sample standard deviation of daily strategy returns, annualized by √252.",
    },
    {
      label: "Sortino Ratio",
      value: ratio(metrics?.sortino),
      tip: "Annualized excess return divided by downside deviation. The existing 0% risk-free assumption applies.",
    },
    {
      label: "Beta vs. SPY",
      value: ratio(spy?.beta),
      tip: "Covariance of aligned daily strategy and SPY returns divided by SPY variance.",
    },
    {
      label: "Correlation vs. SPY",
      value: ratio(spy?.correlation),
      tip: "Pearson correlation of aligned daily strategy and SPY returns.",
    },
    {
      label: "Tracking Error vs. SPY",
      value: formatPercent(spy?.trackingError),
      tip: "Sample standard deviation of daily active returns versus SPY, annualized by √252.",
    },
    {
      label: "Information Ratio vs. SPY",
      value: ratio(spy?.informationRatio),
      tip: "Annualized mean daily active return divided by active-return volatility.",
    },
    {
      label: "Beta vs. SPMO",
      value: ratio(spmo?.beta),
      tip: "Covariance of aligned daily strategy and SPMO returns divided by SPMO variance.",
    },
    {
      label: "Tracking Error vs. SPMO",
      value: formatPercent(spmo?.trackingError),
      tip: "Sample standard deviation of daily active returns versus SPMO, annualized by √252.",
    },
  ];
  return (
    <DashboardCard title="Risk & Benchmark Analysis" className="backtest-risk-card">
      <div className="backtest-return-metrics backtest-risk-metrics" aria-label="Risk and benchmark metrics">
        {analysisMetrics.map(({ label, value, tip }) => (
          <div className="backtest-metric-tile" key={label}>
            <span className="backtest-metric-tile__label">
              {label}
              <InfoTooltip label={label}>{tip}</InfoTooltip>
            </span>
            <strong>
              {state === "loading"
                ? <Skeleton width="72px" height="16px" />
                : value}
            </strong>
          </div>
        ))}
      </div>
      {state !== "ready" && state !== "loading" && (
        <DataState
          state={state}
          title="Risk analysis unavailable"
          detail="The latest validated benchmark series are not available."
          className="backtest-summary-state"
        />
      )}
    </DashboardCard>
  );
}

function AdvancedSettings({ open, onToggle, draft, updateDraft, amountErrors }) {
  const cashflowDirection = draft.cashflowDirection === "outflow" ? "outflow" : "inflow";
  const summary = `${formatMoney(Number(draft.initialCapital))} initial${draft.cashflowEnabled ? ` · ${formatMoney(Number(draft.contributionAmount))} ${draft.contributionFrequency} ${cashflowDirection}` : " · No cashflows"} · Reinvest: ${draft.reinvestDividends ? "On" : "Off"} · Rebalance: ${rebalanceSummaryLabel(draft.rebalanceFrequency)}`;
  return (
    <section className="backtest-advanced" data-open={open || undefined}>
      <button className="backtest-advanced__toggle" type="button" aria-expanded={open} onClick={onToggle}>
        <span className="backtest-advanced__title"><SlidersHorizontal size={21} weight="regular" aria-hidden="true" /><span>Advanced Settings</span></span>
        <span className="backtest-advanced__summary">{summary}</span>
        <CaretDown size={20} weight="bold" aria-hidden="true" className="backtest-advanced__caret" />
      </button>
      <div className="backtest-advanced__reveal" aria-hidden={!open} inert={!open}>
        <div className="backtest-advanced__inner">
          <div className="backtest-advanced__grid">
            <SettingsCard
              title="Initial Capital"
              icon={Coins}
              className="backtest-capital-card backtest-advanced__initial"
              action={(
                <CurrencyInput
                  className="backtest-capital-field"
                  id="backtest-initial-capital"
                  value={draft.initialCapital}
                  onChange={(value) => updateDraft({ initialCapital: value })}
                  ariaLabel="Initial capital in US dollars"
                  invalid={Boolean(amountErrors.initialCapital)}
                />
              )}
            />

            <SettingsRow
              title="Reinvest Dividends"
              description="Adjusted closes already include dividend reinvestment, so no dividend cash amount is added again."
              icon={TrendUp}
              className="backtest-advanced__reinvest"
            >
              <Toggle
                label="Reinvest Dividends"
                checked={draft.reinvestDividends}
                onChange={(checked) => updateDraft({ reinvestDividends: checked })}
              />
            </SettingsRow>

            <SettingsCard
              title="Cashflows"
              icon={Coins}
              description="Add or withdraw external cashflows at the close of the first trading day in each period."
              className="backtest-cashflow-card backtest-advanced__cashflows"
              action={(
                <Toggle
                  label="Cashflows"
                  checked={draft.cashflowEnabled}
                  onChange={(checked) => updateDraft({ cashflowEnabled: checked })}
                />
              )}
            >
              <div
                className="backtest-cashflow-controls"
                data-open={draft.cashflowEnabled || undefined}
                aria-hidden={!draft.cashflowEnabled}
                inert={!draft.cashflowEnabled}
              >
                <div className="backtest-cashflow-direction" role="group" aria-label="Cashflow direction">
                  {["inflow", "outflow"].map((direction) => {
                    const selected = cashflowDirection === direction;
                    return (
                      <button
                        key={direction}
                        type="button"
                        className="backtest-cashflow-direction__segment"
                        data-direction={direction}
                        aria-pressed={selected}
                        onClick={() => updateDraft({ cashflowDirection: direction })}
                      >
                        {direction === "inflow" ? "Inflow" : "Outflow"}
                      </button>
                    );
                  })}
                </div>
                <div className="backtest-cashflow-fields">
                  <label htmlFor="backtest-contribution-amount">Contribution Amount</label>
                  <CurrencyInput
                    id="backtest-contribution-amount"
                    value={draft.contributionAmount}
                    onChange={(value) => updateDraft({ contributionAmount: value })}
                    ariaLabel="Contribution amount in US dollars"
                    invalid={Boolean(amountErrors.contributionAmount)}
                  />
                  <label htmlFor="backtest-contribution-frequency">Frequency</label>
                  <Dropdown
                    id="backtest-contribution-frequency"
                    value={draft.contributionFrequency}
                    onChange={(event) => updateDraft({ contributionFrequency: event.target.value })}
                    options={[
                      { value: "monthly", label: "Monthly" },
                      { value: "quarterly", label: "Quarterly" },
                      { value: "annually", label: "Annually" },
                    ]}
                    ariaLabel="Contribution frequency"
                  />
                </div>
              </div>
            </SettingsCard>

            <div className="backtest-advanced__lower-settings">
              <SettingsRow
                title="Inflation Adjusted"
                description="Convert nominal values and returns into real terms using dated US CPI-U observations."
                icon={ChartBar}
              >
                <Toggle
                  label="Inflation Adjusted"
                  checked={draft.inflationAdjusted}
                  onChange={(checked) => updateDraft({ inflationAdjusted: checked })}
                />
              </SettingsRow>
              <SettingsRow
                title="Rebalancing"
                description="Signals use the final scheduled trading session in each selected month; trades execute at the next available close."
                icon={Scales}
                className="backtest-rebalance-row"
              >
                <Dropdown
                  id="backtest-rebalance-frequency"
                  className="backtest-rebalance-control"
                  value={draft.rebalanceFrequency}
                  options={REBALANCE_OPTIONS}
                  onChange={(event) => updateDraft({ rebalanceFrequency: event.target.value })}
                  ariaLabel="Rebalancing schedule"
                />
              </SettingsRow>
              <SettingsRow
                title="Include YTD"
                description="Include the current partial calendar year as a clearly labelled YTD row."
                icon={CalendarBlank}
              >
                <Toggle
                  label="Include YTD"
                  checked={draft.includeYtd}
                  onChange={(checked) => updateDraft({ includeYtd: checked })}
                />
              </SettingsRow>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BacktestingPage({ hidden = false, onSelectStock }) {
  const {
    data,
    refresh,
    status,
    error,
    refreshing,
    runBacktest: executeBacktest,
    setStrategyRebalanceFrequency,
  } = useMarket();
  const { universe, selectUniverse, activeUniverse, activateUniverse } = useUniverse();
  const [draft, setDraft] = useState(DEFAULT_CONFIG);
  const [submittedConfig, setSubmittedConfig] = useState(null);
  const [customRun, setCustomRun] = useState(null);
  const [range, setRange] = useState("All");
  const [logScale, setLogScale] = useState(false);
  // The default view is the money the investor actually holds, because that is
  // what the cashflow configuration changes.
  const [chartView, setChartView] = useState("value");
  const [drawdownBasis, setDrawdownBasis] = useState("investment");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notification, setNotification] = useState(null);
  const [validationTouched, setValidationTouched] = useState(false);
  const notificationTimer = useRef(null);
  const runSequence = useRef(0);

  const draftBlock = data?.backtest?.[universe] ?? null;
  const submittedRunKey = backtestRunKey(submittedConfig);
  const customResultBlock = customRun?.key === submittedRunKey ? customRun.block : null;
  const snapshotResultBlock = submittedConfig
    ? data?.backtest?.[submittedConfig.portfolio] ?? null
    : null;
  const resultBlock = customResultBlock
    ?? (submittedConfig?.rebalanceFrequency === DEFAULT_REBALANCE_FREQUENCY
      ? snapshotResultBlock
      : null);
  const cpi = data?.macro?.cpi ?? null;
  const sourceState = getSectionState({
    hasData: Boolean(draftBlock?.available),
    status,
    error,
    refreshing,
  });

  useEffect(() => {
    if (!draftBlock?.available) return;
    setDraft((current) => ({
      ...current,
      startDate: current.startDate || draftBlock.start,
      endDate: current.endDate || draftBlock.end,
    }));
    // Start from the dataset the other pages are showing, so the first render
    // cannot present one universe's results beside another universe's data.
    setSubmittedConfig((current) => current ?? {
      ...DEFAULT_CONFIG,
      portfolio: activeUniverse,
      startDate: draftBlock.start,
      endDate: draftBlock.end,
      initialCapital: Number(DEFAULT_CONFIG.initialCapital),
      contributionAmount: Number(DEFAULT_CONFIG.contributionAmount),
    });
  }, [draftBlock?.available, draftBlock?.start, draftBlock?.end, activeUniverse]);

  useEffect(() => () => {
    window.clearTimeout(notificationTimer.current);
    runSequence.current += 1;
  }, []);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
    if (patch.rebalanceFrequency) {
      setStrategyRebalanceFrequency(patch.rebalanceFrequency);
    }
    if ("startDate" in patch || "endDate" in patch) setValidationTouched(true);
    if ("initialCapital" in patch || "contributionAmount" in patch) setValidationTouched(true);
  }

  function selectBacktestUniverse(value) {
    if (value === universe) return;
    selectUniverse(value);
  }

  function showNotification(message, kind = "updated", durationMs = 3200, id = message, retry = false) {
    window.clearTimeout(notificationTimer.current);
    setNotification({
      id,
      message,
      kind,
      durationMs,
      retry,
      onDismiss: durationMs == null ? () => setNotification(null) : undefined,
    });
    if (Number.isFinite(durationMs)) {
      notificationTimer.current = window.setTimeout(() => setNotification(null), durationMs);
    }
  }

  const amountErrors = useMemo(() => {
    const errors = {};
    const initial = Number(draft.initialCapital);
    const contribution = Number(draft.contributionAmount);
    if (!Number.isFinite(initial) || initial <= 0) errors.initialCapital = "Initial capital must be greater than $0.";
    if (draft.cashflowEnabled && (!Number.isFinite(contribution) || contribution <= 0)) {
      errors.contributionAmount = "Contribution amount must be greater than $0.";
    }
    return errors;
  }, [draft.cashflowEnabled, draft.contributionAmount, draft.initialCapital]);

  const dateError = useMemo(() => {
    if (!draftBlock?.available) return "";
    if (!draft.startDate || !draft.endDate) return "Choose both a start and end date.";
    if (draft.startDate < draftBlock.start || draft.endDate > draftBlock.end) {
      return `Choose dates between ${formatDate(draftBlock.start)} and ${formatDate(draftBlock.end)}.`;
    }
    if (draft.startDate >= draft.endDate) return "End date must be after start date.";
    return "";
  }, [draft.endDate, draft.startDate, draftBlock]);

  const availability = getBacktestAvailability({
    reinvestDividends: draft.reinvestDividends,
    inflationAdjusted: draft.inflationAdjusted,
    block: draftBlock,
    cpi,
  });
  const canRun = Boolean(draftBlock?.available) && !dateError && !Object.keys(amountErrors).length && availability.available;
  const normalizedDraft = {
    ...draft,
    portfolio: universe,
    initialCapital: Number(draft.initialCapital),
    contributionAmount: Number(draft.contributionAmount),
  };

  useEffect(() => {
    if (!draftBlock || sourceState === "loading" || sourceState === "error") {
      setNotification((current) => (current?.id === "unavailable-mode" ? null : current));
      return;
    }
    if (availability.available) {
      setNotification((current) => (current?.id === "unavailable-mode" ? null : current));
      return;
    }
    window.clearTimeout(notificationTimer.current);
    setNotification({
      id: "unavailable-mode",
      message: availability.title,
      detail: availability.detail,
      kind: "error",
      durationMs: undefined,
      onDismiss: () => setNotification((current) => (current?.id === "unavailable-mode" ? null : current)),
    });
  }, [availability.available, availability.detail, availability.title, draftBlock, sourceState]);

  useEffect(() => {
    if (!validationTouched) return;
    const message = dateError
      ? "Invalid date range"
      : amountErrors.initialCapital
        ? "Invalid initial capital"
        : amountErrors.contributionAmount
          ? "Invalid contribution amount"
          : "";
    if (message) {
      window.clearTimeout(notificationTimer.current);
      setNotification((current) => ({
        id: "validation",
        message,
        kind: "error",
        durationMs: undefined,
        onDismiss: () => setNotification((active) => (active?.id === "validation" ? null : active)),
      }));
    } else {
      setNotification((current) => (current?.id === "validation" ? null : current));
    }
  }, [amountErrors, dateError, validationTouched]);

  const nominalReportWindow = useMemo(
    () => submittedConfig
      ? buildWindow(
        resultBlock,
        submittedConfig.startDate,
        submittedConfig.endDate,
        "All",
        submittedConfig.reinvestDividends,
      )
      : null,
    [resultBlock, submittedConfig],
  );
  const reportWindow = useMemo(
    () => {
      if (!nominalReportWindow) return null;
      if (!submittedConfig?.inflationAdjusted) return nominalReportWindow;
      const adjusted = applyInflationAdjustment(nominalReportWindow, cpi);
      return adjusted.available === false ? null : adjusted;
    },
    [cpi, nominalReportWindow, submittedConfig?.inflationAdjusted],
  );
  const nominalChartWindow = useMemo(
    () => submittedConfig
      ? buildWindow(
        resultBlock,
        submittedConfig.startDate,
        submittedConfig.endDate,
        range,
        submittedConfig.reinvestDividends,
      )
      : null,
    [range, resultBlock, submittedConfig],
  );
  const chartWindow = useMemo(
    () => {
      if (!nominalChartWindow) return null;
      if (!submittedConfig?.inflationAdjusted) return nominalChartWindow;
      const adjusted = applyInflationAdjustment(nominalChartWindow, cpi);
      return adjusted.available === false ? null : adjusted;
    },
    [cpi, nominalChartWindow, submittedConfig?.inflationAdjusted],
  );
  const analysis = useMemo(
    () => (reportWindow && submittedConfig
      ? buildBacktestAnalysis(
        reportWindow,
        submittedConfig,
        submittedConfig.inflationAdjusted ? null : resultBlock?.cashflowAccounts,
      )
      : null),
    [reportWindow, resultBlock, submittedConfig],
  );
  // One analysis drives every card, chart and export. `report` is the same
  // object so no consumer can accidentally read a second calculation path.
  const report = analysis;
  const chartBounds = useMemo(() => {
    if (!reportWindow?.dates?.length || !chartWindow?.dates?.length) return null;
    const position = new Map(reportWindow.dates.map((date, index) => [date, index]));
    const start = position.get(chartWindow.dates[0]);
    const end = position.get(chartWindow.dates.at(-1));
    return start == null || end == null ? null : { start, end };
  }, [chartWindow, reportWindow]);
  // A range filter changes what is visible, not how the account was run: the
  // series are sliced out of the single simulation instead of being re-simulated
  // on a shorter window with fresh opening capital.
  const chartSeries = useMemo(() => {
    if (!analysis || !chartBounds) return {};
    return Object.fromEntries(
      ["strategy", "spy", "spmo"].map((id) => {
        const account = analysis.accounts?.[id];
        return [
          id,
          account
            ? sliceAccountSeries(account, chartBounds.start, chartBounds.end)
            : { values: [], returns: [] },
        ];
      }),
    );
  }, [analysis, chartBounds]);
  const metrics = useMemo(
    () => computeWindowMetrics(
      reportWindow,
      submittedConfig?.reinvestDividends && !submittedConfig?.inflationAdjusted
        ? resultBlock?.metrics ?? null
        : null,
    ),
    [reportWindow, resultBlock, submittedConfig?.inflationAdjusted, submittedConfig?.reinvestDividends],
  );
  // Investment drawdown is the unitized-NAV measurement; the account-balance
  // variant is published by the shared simulation.
  const investmentDrawdown = useMemo(
    () => (reportWindow ? analyzeDrawdown(reportWindow.strategy, reportWindow.dates) : null),
    [reportWindow],
  );
  const drawdownView = useMemo(() => {
    if (drawdownBasis === "account") {
      return {
        basis: "account",
        series: analysis?.accountDrawdown?.series ?? [],
        peakDate: analysis?.accountDrawdown?.peakDate ?? null,
        troughDate: analysis?.accountDrawdown?.troughDate ?? null,
        recoveryDate: analysis?.accountDrawdown?.recoveryDate ?? null,
        max: analysis?.accountDrawdown?.maxDrawdown ?? null,
      };
    }
    return {
      basis: "investment",
      series: investmentDrawdown?.series ?? [],
      peakDate: investmentDrawdown?.peakDate ?? null,
      troughDate: investmentDrawdown?.troughDate ?? null,
      recoveryDate: investmentDrawdown?.recoveryDate ?? null,
      max: Number.isFinite(metrics?.maxDrawdown)
        ? metrics.maxDrawdown
        : investmentDrawdown?.maxDrawdown ?? null,
    };
  }, [analysis, drawdownBasis, investmentDrawdown, metrics]);
  const resultsReady = Boolean(report && reportWindow && chartWindow);
  const resultsState = isRunning
    ? "loading"
    : resultsReady
      ? "ready"
      : sourceState === "ready" && draftBlock?.available && !submittedConfig
        ? "loading"
        : sourceState;
  const resultsLoading = !resultsReady && resultsState === "loading";
  // With cashflows enabled the primary performance figure is the investor's own
  // money-weighted return; the flow-neutral TWR stays one click away in the
  // KPI detail and in the Performance Summary.
  const cashflowPrimary = Boolean(submittedConfig?.cashflowEnabled);
  const headlineReturn = cashflowPrimary
    ? report?.moneyWeightedReturnPct
    : report?.timeWeightedReturnPct ?? metrics.totalReturn;
  // Pending universe/rebalance changes only update the draft. They never raise
  // a notification: feedback belongs to Run Backtest and its real outcome.

  useEffect(() => {
    if (!data || !submittedConfig || resultBlock?.available || sourceState !== "ready") {
      setNotification((current) => (current?.id === "missing-data" ? null : current));
      return;
    }
    showNotification("Missing price history", "error", undefined, "missing-data", true);
  }, [data, resultBlock?.available, sourceState, submittedConfig]);

  async function runBacktest() {
    if (!canRun || isRunning) return;
    const sequence = runSequence.current + 1;
    runSequence.current = sequence;
    setIsRunning(true);
    showNotification("Running selected rebalance schedule…", "loading", undefined, "backtest-running");
    try {
      const block = await executeBacktest({
        portfolio: normalizedDraft.portfolio,
        start: normalizedDraft.startDate,
        end: normalizedDraft.endDate,
        rebalance_frequency: normalizedDraft.rebalanceFrequency,
        initial_capital: normalizedDraft.initialCapital,
        cashflow_enabled: normalizedDraft.cashflowEnabled,
        cashflow_amount: normalizedDraft.contributionAmount,
        cashflow_frequency: normalizedDraft.contributionFrequency,
        cashflow_direction: normalizedDraft.cashflowDirection,
      });
      if (runSequence.current !== sequence) return;
      if (!block?.available) {
        showNotification(
          block?.reason || "The backtest could not construct a valid portfolio.",
          "error",
          undefined,
          "backtest-unavailable",
          "backtest",
        );
        return;
      }
      const key = backtestRunKey(normalizedDraft);
      setCustomRun({ key, block });
      setSubmittedConfig(normalizedDraft);
      // A completed run defines the dataset every other page displays.
      activateUniverse(normalizedDraft.portfolio);
      showNotification("Backtest completed", "updated", 3200, "backtest-complete");
    } catch (requestError) {
      if (runSequence.current !== sequence) return;
      showNotification(
        requestError?.message || "The backtest service could not complete the run.",
        "error",
        undefined,
        "backtest-request-error",
        "backtest",
      );
    } finally {
      if (runSequence.current === sequence) setIsRunning(false);
    }
  }

  async function refreshPreview() {
    await refresh();
  }

  async function exportBacktest(format) {
    if (!reportWindow || !submittedConfig || isExporting) return;
    setIsExporting(true);
    try {
      const exportedAt = new Date();
      const exportData = buildBacktestExportData({
        window: reportWindow,
        block: resultBlock,
        config: submittedConfig,
        stocks: data?.stocks ?? [],
        portfolios: data?.portfolios ?? {},
        meta: data?.meta ?? null,
        exportedAt: exportedAt.toISOString(),
      });
      if (format === "csv") {
        downloadBacktestCsv(
          backtestFilename(submittedConfig, "csv", exportedAt),
          exportData.csv,
        );
      } else {
        await downloadWorkbookFile(
          backtestFilename(submittedConfig, "xlsx", exportedAt),
          exportData.workbookSheets,
        );
      }
      showNotification("Export completed", "updated", 3200, "backtest-export-complete");
    } catch (exportError) {
      showNotification(
        exportError?.message || "Export failed",
        "error",
        5200,
        "backtest-export-error",
      );
    } finally {
      setIsExporting(false);
    }
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
              dateTime={resultBlock?.end ?? draftBlock?.end ?? ""}
              ariaLabel="Refresh backtest data"
              busy={isRunning}
              onRefresh={refreshPreview}
            />
          )}
        />

        <div className="backtest-control-card">
          <section className="backtest-config" aria-label="Backtest configuration" aria-busy={isRunning}>
            <div className="backtest-config__period">
              <div className="backtest-config__heading">
                <CalendarBlank size={21} weight="regular" aria-hidden="true" />
                <h2>Backtest Period</h2>
              </div>
              <div className="backtest-date-fields">
                <div className={`backtest-date-group${dateError ? " is-invalid" : ""}`}>
                  <label className="backtest-date-label" htmlFor="backtest-start-date">Start Date</label>
                  <div className="backtest-date-control">
                    <input
                      className="backtest-date-input"
                      id="backtest-start-date"
                      type="date"
                      min={draftBlock?.start ?? ""}
                      max={draftBlock?.end ?? ""}
                      value={draft.startDate}
                      aria-invalid={Boolean(dateError)}
                      onInput={(event) => updateDraft({ startDate: event.target.value })}
                      onChange={(event) => updateDraft({ startDate: event.target.value })}
                    />
                  </div>
                </div>
                <div className={`backtest-date-group${dateError ? " is-invalid" : ""}`}>
                  <label className="backtest-date-label" htmlFor="backtest-end-date">End Date</label>
                  <div className="backtest-date-control">
                    <input
                      className="backtest-date-input"
                      id="backtest-end-date"
                      type="date"
                      min={draftBlock?.start ?? ""}
                      max={draftBlock?.end ?? ""}
                      value={draft.endDate}
                      aria-invalid={Boolean(dateError)}
                      onInput={(event) => updateDraft({ endDate: event.target.value })}
                      onChange={(event) => updateDraft({ endDate: event.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            <span className="backtest-config__divider" aria-hidden="true" />

            <div className="backtest-config__universe">
              <div className="backtest-config__heading">
                <Stack size={21} weight="regular" aria-hidden="true" />
                <h2>Universe</h2>
              </div>
              <div className="backtest-segmented" role="group" aria-label="Portfolio selection">
                {UNIVERSE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={universe === value}
                    onClick={() => selectBacktestUniverse(value)}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div className="backtest-run-group">
              <AppButton
                variant="primary"
                icon={Play}
                className="backtest-run-button"
                disabled={!canRun || isRunning}
                onClick={runBacktest}
              >{isRunning ? "Running…" : "Run Backtest"}</AppButton>
            </div>
          </section>

          <AdvancedSettings
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((current) => !current)}
            draft={draft}
            updateDraft={updateDraft}
            amountErrors={amountErrors}
          />
        </div>

        <div
          className="backtest-results"
          data-loading={isRunning || undefined}
          data-state={resultsState}
          aria-busy={isRunning || resultsLoading || undefined}
        >
          <section className="backtest-kpis" aria-label="Backtest summary">
            <KpiCard
              loading={resultsLoading}
              label="Start Balance"
              value={report ? formatMoney(report.initialCapital) : "—"}
              icon={Bank}
              tint="blue"
              mascotVariant="blue"
              mascotColor="var(--color-blue)"
            />
            <KpiCard
              loading={resultsLoading}
              label="End Balance"
              value={report ? formatMoney(report.finalValue) : "—"}
              icon={Coins}
              tint="pink"
              mascotVariant="pink"
              mascotColor="var(--color-pink)"
            />
            <KpiCard
              loading={resultsLoading}
              label="Duration"
              value={formatBacktestDuration(reportWindow?.dates?.[0], reportWindow?.dates?.at(-1))}
              icon={CalendarBlank}
              tint="cream"
              mascotVariant="cream"
              mascotColor="var(--color-cream)"
            />
            <KpiCard
              loading={resultsLoading}
              label={cashflowPrimary ? "Investor Return" : "Total Return"}
              detail={cashflowPrimary && report && !resultsLoading
                ? `XIRR · TWR ${formatPercent(report.timeWeightedReturnPct)}`
                : undefined}
              value={formatPercent(headlineReturn)}
              valueTone={valueTone(headlineReturn)}
              icon={Stack}
              tint="mint"
              mascotVariant="mint"
              mascotColor="var(--color-mint)"
            />
          </section>

          <DashboardCard
            title="Portfolio Performance"
            className="backtest-cumulative-card"
            action={(
              <div className="backtest-chart-controls">
                <div className="period-control backtest-view-control" role="group" aria-label="Chart view">
                  {CHART_VIEWS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={chartView === item.id}
                      onClick={() => setChartView(item.id)}
                    >{item.label}</button>
                  ))}
                </div>
                <LogScaleToggle checked={logScale} onChange={setLogScale} />
                <div className="period-control backtest-range-control" role="group" aria-label="Chart time range">
                  {RANGES.map((item) => (
                    <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>
                  ))}
                </div>
                <ExportMenu
                  onExport={exportBacktest}
                  disabled={!resultsReady}
                  busy={isExporting}
                  ariaLabel="Export complete backtest results"
                />
              </div>
            )}
          >
            <div className="performance-legend backtest-cumulative-legend" aria-label="Return series">
              {SERIES.map((series) => (
                <span className={`performance-legend__item performance-legend__item--${series.id}`} key={series.id}>
                  <i aria-hidden="true" />{series.name}
                </span>
              ))}
            </div>
            {chartWindow && chartSeries.strategy?.values.length ? (
              <CumulativeChart
                dates={chartWindow.dates}
                range={range}
                view={chartView}
                logScale={logScale}
                seriesValues={chartSeries}
                onLogUnavailable={() => {
                  setLogScale(false);
                  showNotification("Log scale unavailable for this window", "error", 4200, "log-scale");
                }}
              />
            ) : (
              <ChartState
                state={resultsState}
                title={resultsState === "error" ? "Cumulative return unavailable" : "No cumulative return data"}
                detail={resultsState === "error"
                  ? "The latest validated backtest series could not be loaded."
                  : "Run a backtest after the first verified data update to populate this chart."}
                className="backtest-chart-pending"
              />
            )}
          </DashboardCard>

          <section className="backtest-analytics-grid" aria-label="Drawdown and annual returns">
            <DashboardCard
              title="Drawdown"
              className="backtest-drawdown-card"
              action={(
                <div className="backtest-drawdown-controls">
                  <div className="period-control backtest-drawdown-control" role="group" aria-label="Drawdown basis">
                    <button
                      type="button"
                      aria-pressed={drawdownBasis === "investment"}
                      onClick={() => setDrawdownBasis("investment")}
                    >Investment</button>
                    <button
                      type="button"
                      aria-pressed={drawdownBasis === "account"}
                      onClick={() => setDrawdownBasis("account")}
                    >Account</button>
                  </div>
                  <span className="backtest-max-drawdown">Max {formatPercent(drawdownView.max)}</span>
                </div>
              )}
            >
              {reportWindow && drawdownView.series.length ? (
                <>
                  <DrawdownChart
                    dates={reportWindow.dates}
                    values={drawdownView.series}
                    basis={drawdownView.basis}
                  />
                  <p className="backtest-drawdown-meta">
                    {drawdownView.peakDate
                      ? [
                        `Max ${formatPercent(drawdownView.max)}`,
                        `${drawdownView.peakDate} → ${drawdownView.troughDate}`,
                        drawdownView.recoveryDate
                          ? `recovered ${drawdownView.recoveryDate}`
                          : "not recovered",
                      ].join(" · ")
                      : "No drawdown inside this window."}
                  </p>
                </>
              ) : (
                <ChartState
                  state={resultsState}
                  title={resultsState === "error" ? "Drawdown unavailable" : "No drawdown data"}
                  detail={resultsState === "error"
                    ? "The latest validated drawdown series could not be loaded."
                    : "Drawdown appears after a validated backtest is available."}
                  className="backtest-drawdown-pending"
                />
              )}
            </DashboardCard>

            <AnnualReturnTable
              rows={report?.annualRows ?? []}
              includeYtd={submittedConfig?.includeYtd ?? draft.includeYtd}
              state={resultsReady ? "ready" : resultsState}
            />
          </section>
          <MonthlyReturnTable
            rows={report?.monthlyRows ?? []}
            state={resultsReady ? "ready" : resultsState}
          />
          <PerformanceSummary
            report={report}
            reportWindow={reportWindow}
            metrics={metrics}
            config={submittedConfig}
            state={resultsReady ? "ready" : resultsState}
          />
          <RiskAnalysis
            metrics={metrics}
            state={resultsReady ? "ready" : resultsState}
          />
          <PortfolioEvolution
            block={resultBlock}
            config={submittedConfig}
            stocks={data?.stocks ?? []}
            portfolios={data?.portfolios ?? {}}
            state={resultsReady ? "ready" : resultsState}
            onSelectStock={onSelectStock}
            onNotify={({ message, kind = "updated", durationMs, id }) => {
              showNotification(
                message,
                kind,
                durationMs ?? (kind === "error" ? undefined : 3200),
                id,
              );
            }}
          />
          </div>
      </div>
      {notification && (
        <Toast
          kind={notification.kind}
          message={notification.message}
          className="page-toast"
          durationMs={notification.durationMs}
          onDismiss={notification.onDismiss}
          action={notification.retry ? (
            <button
              type="button"
              className="notification-toast__action"
              onClick={notification.retry === "backtest" ? runBacktest : refreshPreview}
            >Retry</button>
          ) : null}
        />
      )}
    </main>
  );
}

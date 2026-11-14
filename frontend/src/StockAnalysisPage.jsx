import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChartBar, CrownSimple, Scales, Sigma, Stack } from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { ChartState, Skeleton } from "./components/DataState.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { Mascot, MascotDuo } from "./components/Mascot.jsx";
import { useChartPointer } from "./components/useChartPointer.js";
import { useChartTooltipSize } from "./components/useChartTooltipSize.js";
import { useElementSize } from "./components/useElementSize.js";
import { useMediaQuery } from "./components/useMediaQuery.js";
import { Toast } from "./components/Toast.jsx";
import { UpdateBar } from "./components/UpdateBar.jsx";
import { useMarket, useStockDetail } from "./api/MarketProvider.jsx";
import { getSectionState } from "./utils/dataState.js";
import { formatMarketCap } from "./utils/format.js";
import {
  PRICE_TOOLTIP_HEIGHT,
  PRICE_TOOLTIP_WIDTH,
  fitTooltipWidth,
  formatTooltipDate,
  nearestObservationIndex,
  placePriceTooltip,
  sideForMovement,
} from "./utils/priceTooltip.js";
import { getRankTier } from "./utils/rankTier.js";
import {
  DEFAULT_RANGE,
  formatAxisPrice,
  logPosition,
  priceLogAxis,
  priceRanges,
  rangeStartIndex,
  timeTicks,
} from "./utils/priceRange.js";

function smoothPath(points) {
  if (points.length < 2) return "";
  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const previous2 = points[index - 2] ?? previous;
    const next = points[index + 1] ?? point;
    return `${path} C ${previous.x + (point.x - previous2.x) / 6} ${previous.y + (point.y - previous2.y) / 6}, ${point.x - (next.x - previous.x) / 6} ${point.y - (next.y - previous.y) / 6}, ${point.x} ${point.y}`;
  }, "");
}

function formatMoney(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function signedPercent(value, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

function PriceTooltipContent({ date, price, change, compact = false, width }) {
  const tone = typeof change === "number" && change > 0
    ? "positive"
    : typeof change === "number" && change < 0
      ? "negative"
      : "neutral";
  return (
    <div
      className={`stock-price-tooltip${compact ? " stock-price-tooltip--mobile" : ""}`}
      role="tooltip"
      style={width ? { width } : undefined}
    >
      <span className="stock-price-tooltip__date">{formatTooltipDate(date)}</span>
      <strong className="stock-price-tooltip__price">{formatMoney(price)}</strong>
      <span className={`stock-price-tooltip__change is-${tone}`}>{signedPercent(change, 2)}</span>
    </div>
  );
}

function getPriceTicks(values) {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(maxValue - minValue, 1);
  const rawStep = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const min = Math.floor(minValue / step) * step;
  const max = Math.ceil(maxValue / step) * step;
  return { min, max: max === min ? min + step : max, step };
}

function PriceChart({ stock, range, logScale = false }) {
  const [boxRef, box] = useElementSize();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [tooltipSide, setTooltipSide] = useState("left");
  const [tooltipRef, tooltipSize] = useChartTooltipSize();
  const movementOriginX = useRef(Number.NaN);
  // A touch or pen pointer needs the tap-to-inspect path even on a wide screen:
  // there is no hover to preview with, so the detail is pinned instead.
  const stableTouchDetail = useMediaQuery("(hover: none), (pointer: coarse)");
  const history = stock.priceHistory;
  const allObservationDates = history.observationDates ?? history.dates;
  const allChanges = history.dailyChanges ?? [];
  const startIndex = rangeStartIndex(history.dates, range);
  // One row per observation, so slicing and filtering keep the tooltip's date,
  // price and daily move aligned no matter which range or scale is active.
  const rows = history.dates.slice(startIndex).map((date, offset) => {
    const index = startIndex + offset;
    return {
      date,
      value: history.values[index],
      observationDate: allObservationDates[index] ?? date,
      change: allChanges[index] ?? null,
    };
  });
  // A logarithmic axis cannot plot a non-positive price, so those points are
  // dropped instead of being clamped to a fake floor.
  const plottable = logScale
    ? rows.filter((row) => typeof row.value === "number" && Number.isFinite(row.value) && row.value > 0)
    : rows;
  const drawn = plottable.length >= 2 ? plottable : rows;
  const useLog = logScale && drawn === plottable;
  const visible = drawn.map((row) => row.value);
  const visibleDates = drawn.map((row) => row.date);
  const observationDates = drawn.map((row) => row.observationDate);
  const dailyChanges = drawn.map((row) => row.change);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const ready = width > 0 && height > 0;

  // Phones drop the endpoint price pill so the plot can use the full width.
  const compact = width > 0 && width < 520;
  // Gutters keep the axis labels and the value pill inside the measured box.
  const gutterLeft = compact ? 46 : 54;
  const gutterRight = compact ? 10 : 98;
  const top = compact ? 10 : 14;
  const bottom = compact ? 26 : 30;
  const plot = {
    left: gutterLeft,
    top,
    width: Math.max(60, width - gutterLeft - gutterRight),
    height: Math.max(60, height - top - bottom),
  };
  const plotRight = plot.left + plot.width;

  const linearAxis = getPriceTicks(visible);
  const logAxis = useLog ? priceLogAxis(visible) : null;
  // Six evenly spaced labels on a linear axis; the log axis brings its own
  // ladder ticks because equal pixel steps are not equal price steps.
  const axisTicks = logAxis
    ? logAxis.ticks
    : Array.from(
      { length: compact ? 4 : 6 },
      (_, index) => linearAxis.min + (linearAxis.max - linearAxis.min) * index / (compact ? 3 : 5),
    );
  const yFor = (value) => (
    logAxis
      ? logPosition(value, logAxis, top, plot.height)
      : plot.top + ((linearAxis.max - value) / (linearAxis.max - linearAxis.min)) * plot.height
  );

  const points = visible.map((value, index) => ({
    x: plot.left + (index / Math.max(1, visible.length - 1)) * plot.width,
    y: yFor(value),
  }));
  const line = smoothPath(points);
  const area = points.length
    ? `${line} L ${points.at(-1).x} ${plot.top + plot.height} L ${points[0].x} ${plot.top + plot.height} Z`
    : "";
  const ticks = timeTicks(visibleDates, range);

  // The price pill sits right beside the last point, clamped inside the box.
  const pillWidth = 84;
  const pillHeight = 26;
  const endPoint = points.at(-1);
  const pillX = Math.min(plotRight + 12, width - pillWidth - 4);
  const pillY = endPoint
    ? Math.min(Math.max(endPoint.y - pillHeight / 2, top), height - bottom - pillHeight)
    : top;

  useEffect(() => {
    setSelectedIndex(null);
    movementOriginX.current = Number.NaN;
  }, [range, logScale, stock.ticker]);

  const activeIndex = selectedIndex != null && selectedIndex < points.length ? selectedIndex : null;
  const selectedPoint = activeIndex == null ? null : points[activeIndex];
  const tooltipWidth = fitTooltipWidth({
    containerWidth: width,
    preferredWidth: PRICE_TOOLTIP_WIDTH,
  });
  const tooltipPlacement = selectedPoint
    ? placePriceTooltip({
      anchorX: selectedPoint.x,
      anchorY: selectedPoint.y,
      preferredSide: tooltipSide,
      containerWidth: width,
      containerHeight: height,
      tooltipWidth: tooltipSize?.width ?? tooltipWidth,
      tooltipHeight: tooltipSize?.height ?? PRICE_TOOLTIP_HEIGHT,
    })
    : null;

  function selectPointerPosition(clientX) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return;
    const pointerX = Math.min(Math.max(clientX - rect.left, plot.left), plotRight);
    const nextMovement = sideForMovement({
      pointerX,
      movementOriginX: movementOriginX.current,
      currentSide: tooltipSide,
    });
    movementOriginX.current = nextMovement.movementOriginX;
    if (nextMovement.side !== tooltipSide) setTooltipSide(nextMovement.side);
    setSelectedIndex(nearestObservationIndex(points, pointerX));
  }

  function clearSelection() {
    setSelectedIndex(null);
    movementOriginX.current = Number.NaN;
  }

  const chartPointer = useChartPointer({
    onSelect: selectPointerPosition,
    onDismiss: clearSelection,
  });

  return (
    <div
      className="stock-price-chart-canvas"
      ref={boxRef}
      data-testid="stock-price-chart"
      {...chartPointer}
    >
      {ready && (
        <svg
          className="stock-price-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${stock.ticker} adjusted close over ${range}${logScale ? " on a logarithmic scale" : ""}`}
        >
          <defs>
            <linearGradient id={`price-fill-${stock.ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFE59A" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#FFE59A" stopOpacity="0.035" />
            </linearGradient>
          </defs>
          {axisTicks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line x1={plot.left} x2={plotRight} y1={y} y2={y} className="stock-chart-gridline" />
                <text x={plot.left - 10} y={y + 5} textAnchor="end" className="stock-chart-axis-label">
                  {logAxis ? formatAxisPrice(tick) : `$${Math.round(tick)}`}
                </text>
              </g>
            );
          })}
          {ticks.reduce((kept, tick) => {
            const x = plot.left + (tick.index / Math.max(1, visible.length - 1)) * plot.width;
            if (kept.length && x - kept.at(-1).x < 38) return kept;
            kept.push({ ...tick, x });
            return kept;
          }, []).map(({ index, label, x }) => (
            <text key={`${index}-${label}`} x={x} y={plot.top + plot.height + 21} textAnchor="middle" className="stock-chart-axis-label">{label}</text>
          ))}
          <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.top + plot.height} className="stock-chart-gridline" />
          {points.length > 0 && (
            <>
              <path d={area} fill={`url(#price-fill-${stock.ticker})`} />
              <path d={line} className="stock-price-line" />
              <circle cx={endPoint.x} cy={endPoint.y} r="5.5" className="stock-price-endpoint" />
              {!compact && (
                <>
                  <rect x={pillX} y={pillY} width={pillWidth} height={pillHeight} rx={pillHeight / 2} className="stock-price-value-pill" />
                  <text x={pillX + pillWidth / 2} y={pillY + pillHeight / 2} dominantBaseline="central" textAnchor="middle" className="stock-price-value-label">{formatMoney(visible.at(-1))}</text>
                </>
              )}
            </>
          )}
          {selectedPoint && (
            <g className="stock-price-selection" data-testid="stock-price-selection">
              <line
                x1={selectedPoint.x}
                x2={selectedPoint.x}
                y1={plot.top}
                y2={plot.top + plot.height}
                className="stock-price-crosshair"
              />
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r="10" className="stock-price-selected-halo" />
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r="5.5" className="stock-price-selected-point" />
            </g>
          )}
        </svg>
      )}
      {ready && selectedPoint && (
        stableTouchDetail ? (
          <div className="stock-price-mobile-readout" data-testid="stock-price-mobile-readout">
            <PriceTooltipContent
              compact
              date={observationDates[activeIndex] ?? visibleDates[activeIndex]}
              price={visible[activeIndex]}
              change={dailyChanges[activeIndex]}
            />
          </div>
        ) : (
          <div
            className="stock-price-tooltip-layer"
            ref={tooltipRef}
            style={{ left: tooltipPlacement.x, top: tooltipPlacement.y }}
            data-side={tooltipPlacement.side}
            data-testid="stock-price-tooltip"
          >
            <PriceTooltipContent
              date={observationDates[activeIndex] ?? visibleDates[activeIndex]}
              price={visible[activeIndex]}
              change={dailyChanges[activeIndex]}
              width={tooltipWidth}
            />
          </div>
        )
      )}
    </div>
  );
}

function RankingHistoryChart({ stock }) {
  const [boxRef, box] = useElementSize();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [tooltipSide, setTooltipSide] = useState(null);
  const [tooltipRef, tooltipSize] = useChartTooltipSize();
  const coarsePointer = useMediaQuery("(hover: none), (pointer: coarse)");
  const movementOriginX = useRef(Number.NaN);
  const tooltipSideRef = useRef(null);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const ready = width > 0 && height > 0;

  // Gutters hold the rank axis on the left and the score axis on the right so
  // neither label can ever sit on the card edge.
  const left = 40;
  const right = 42;
  const top = 12;
  const bottom = 40;
  const plotWidth = Math.max(60, width - left - right);
  const plotHeight = Math.max(60, height - top - bottom);

  const history = stock.history ?? [];
  const ranks = history.map((point) => point.rank ?? null);
  const scores = history.map((point) => point.score ?? null);
  const rankMax = Math.max(100, Math.ceil(Math.max(...ranks.filter((value) => value != null), 1) / 25) * 25);
  const scoreValues = scores.filter((value) => value != null);
  const scoreMin = scoreValues.length ? Math.min(...scoreValues) - 0.15 : 1;
  const scoreMax = scoreValues.length ? Math.max(...scoreValues) + 0.15 : 3;
  const scoreSpan = Math.max(scoreMax - scoreMin, 0.3);

  const rankPoints = ranks.map((rank, index) => ({
    x: left + index / Math.max(1, ranks.length - 1) * plotWidth,
    y: rank == null ? null : top + ((rank - 1) / (rankMax - 1)) * plotHeight,
  })).filter((point) => point.y != null);
  const scorePoints = scores.map((score, index) => ({
    x: left + index / Math.max(1, scores.length - 1) * plotWidth,
    y: score == null ? null : top + ((scoreMax - score) / scoreSpan) * plotHeight,
  })).filter((point) => point.y != null);

  const rankPath = smoothPath(rankPoints);
  const scorePath = smoothPath(scorePoints);
  const scoreArea = scorePoints.length
    ? `${scorePath} L ${scorePoints.at(-1).x} ${top + plotHeight} L ${scorePoints[0].x} ${top + plotHeight} Z`
    : "";
  const xIndexes = history.map((_, index) => index).filter((index) => index % 2 === 1 || index === history.length - 1);
  const xPoints = history.map((_, index) => ({
    x: left + index / Math.max(1, history.length - 1) * plotWidth,
  }));
  const selectedPoint = selectedIndex == null ? null : xPoints[selectedIndex];
  const tooltipWidth = fitTooltipWidth({
    containerWidth: width,
    preferredWidth: width > 0 && width < 560 ? 182 : 196,
  });
  const tooltipPlacement = selectedPoint
    ? placePriceTooltip({
      anchorX: selectedPoint.x,
      anchorY: top + plotHeight / 2,
      preferredSide: tooltipSide,
      containerWidth: width,
      containerHeight: height,
      tooltipWidth: tooltipSize?.width ?? tooltipWidth,
      tooltipHeight: tooltipSize?.height ?? 102,
    })
    : null;

  useEffect(() => {
    setSelectedIndex(null);
    setTooltipSide(null);
    movementOriginX.current = Number.NaN;
    tooltipSideRef.current = null;
  }, [stock.ticker, history.length]);

  function selectAt(clientX) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !xPoints.length) return;
    const pointerX = Math.min(Math.max(clientX - rect.left, left), left + plotWidth);
    const nextSide = sideForMovement({
      pointerX,
      movementOriginX: movementOriginX.current,
      currentSide: tooltipSideRef.current,
    });
    movementOriginX.current = nextSide.movementOriginX;
    tooltipSideRef.current = nextSide.side;
    setTooltipSide(nextSide.side);
    setSelectedIndex(nearestObservationIndex(xPoints, pointerX));
  }

  function clearSelection() {
    setSelectedIndex(null);
    movementOriginX.current = Number.NaN;
    tooltipSideRef.current = null;
    setTooltipSide(null);
  }

  const chartPointer = useChartPointer({
    onSelect: selectAt,
    onDismiss: clearSelection,
  });

  return (
    <div
      className="ranking-chart-canvas"
      ref={boxRef}
      {...chartPointer}
    >
      {ready && (
        <svg
          className="ranking-history-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${stock.ticker} ranking history, latest rank ${stock.rank} and momentum score ${stock.score.toFixed(2)}`}
        >
          <defs><linearGradient id={`rank-fill-${stock.ticker}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C9B8F4" stopOpacity="0.24" /><stop offset="100%" stopColor="#C9B8F4" stopOpacity="0.035" /></linearGradient></defs>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const rank = Math.round(1 + fraction * (rankMax - 1));
            const y = top + fraction * plotHeight;
            return <g key={`rank-${rank}`}><line x1={left} x2={left + plotWidth} y1={y} y2={y} className="stock-chart-gridline" /><text x={left - 9} y={y + 5} textAnchor="end" className="stock-chart-axis-label">{rank}</text></g>;
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const score = scoreMax - fraction * scoreSpan;
            const y = top + fraction * plotHeight;
            return <text key={`score-${fraction}`} x={left + plotWidth + 9} y={y + 5} className="stock-chart-axis-label">{score.toFixed(1)}</text>;
          })}
          {xIndexes.map((index) => {
            const x = left + (index / Math.max(1, history.length - 1)) * plotWidth;
            return <text key={index} x={x} y={top + plotHeight + 26} textAnchor="middle" className="stock-chart-axis-label">{history[index].month}</text>;
          })}
          <line x1={left} x2={left} y1={top} y2={top + plotHeight} className="stock-chart-gridline" />
          <line x1={left + plotWidth} x2={left + plotWidth} y1={top} y2={top + plotHeight} className="stock-chart-gridline" />
          {scoreArea && <path d={scoreArea} fill={`url(#rank-fill-${stock.ticker})`} />}
          {scorePath && <path d={scorePath} className="ranking-score-line" />}
          {rankPath && <path d={rankPath} className="ranking-rank-line" />}
          {rankPoints.length > 0 && <circle cx={rankPoints.at(-1).x} cy={rankPoints.at(-1).y} r="5" className="ranking-rank-endpoint" />}
          {scorePoints.length > 0 && <circle cx={scorePoints.at(-1).x} cy={scorePoints.at(-1).y} r="5" className="ranking-score-endpoint" />}
          {selectedPoint && (
            <g data-testid="ranking-history-selection">
              <line x1={selectedPoint.x} x2={selectedPoint.x} y1={top} y2={top + plotHeight} className="backtest-crosshair" />
              {history[selectedIndex]?.rank != null && (
                <circle cx={selectedPoint.x} cy={top + ((history[selectedIndex].rank - 1) / (rankMax - 1)) * plotHeight} r="4.5" className="backtest-hover-point backtest-hover-point--strategy" />
              )}
              {history[selectedIndex]?.score != null && (
                <circle cx={selectedPoint.x} cy={top + ((scoreMax - history[selectedIndex].score) / scoreSpan) * plotHeight} r="4.5" className="backtest-hover-point backtest-hover-point--spmo" />
              )}
            </g>
          )}
        </svg>
      )}
      {ready && selectedPoint && (
        <div
          className="backtest-floating-tooltip"
          style={{ left: tooltipPlacement.x, top: coarsePointer ? 8 : tooltipPlacement.y }}
          data-testid="ranking-history-tooltip"
        >
          <div
            className="backtest-chart-tooltip backtest-chart-tooltip--compact"
            role="tooltip"
            ref={tooltipRef}
            style={{ width: tooltipWidth }}
          >
            <span className="backtest-chart-tooltip__date">{formatTooltipDate(history[selectedIndex]?.date)}</span>
            <span className="stock-ranking-tooltip__row"><i className="stock-ranking-legend__rank" aria-hidden="true" /><span>Rank</span><strong>{history[selectedIndex]?.rank ?? "—"}</strong></span>
            <span className="stock-ranking-tooltip__row"><i className="stock-ranking-legend__score" aria-hidden="true" /><span>Momentum Score</span><strong>{history[selectedIndex]?.score == null ? "—" : history[selectedIndex].score.toFixed(2)}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}

export function StockAnalysisPage({ ticker = "NVDA", onBack, backLabel = "Screener" }) {
  const {
    data: stockPayload,
    status: stockStatus,
    error: stockError,
    reload: reloadStock,
    refreshing: stockRefreshing,
  } = useStockDetail(ticker);
  const stock = stockPayload?.priceHistory ? stockPayload : null;
  const {
    data: market,
    staticMode,
    status: marketStatus,
    error: marketError,
    refresh,
  } = useMarket();
  // 1Y is the documented default: it is the window the momentum column refers
  // to, so the chart and the 12M figures agree on first paint.
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [logScale, setLogScale] = useState(false);
  const [stockErrorDismissed, setStockErrorDismissed] = useState(false);

  // The badge colour follows the stock's percentile inside the eligible
  // universe — the same universe and ranks the Screener lists.
  const universeSize = market?.stocks?.length ?? 0;
  const rankTier = getRankTier(stock?.rank, universeSize);

  const returnRows = useMemo(() => (stock ? [
    ["1M Return", stock.priceHistory.returns.oneMonth],
    ["3M Return", stock.priceHistory.returns.threeMonth],
    ["6M Return", stock.priceHistory.returns.sixMonth],
    ["12M Price Return", stock.priceHistory.returns.twelveMonth],
  ] : []), [stock]);
  const summaryState = getSectionState({
    hasData: Boolean(stock),
    status: stockStatus,
    error: stockError,
  });
  const priceState = getSectionState({
    hasData: Boolean(stock?.priceHistory?.values?.length),
    status: stockStatus,
    error: stockError,
  });
  const returnsState = getSectionState({
    hasData: returnRows.length > 0,
    status: stockStatus,
    error: stockError,
  });
  const rankingState = getSectionState({
    hasData: Boolean(stock?.history?.length),
    status: stockStatus,
    error: stockError,
  });

  useEffect(() => {
    setStockErrorDismissed(false);
  }, [stockError, ticker]);

  const showStockError = Boolean(stockError)
    && !staticMode
    && !marketError
    && marketStatus !== "error"
    && !stockErrorDismissed;

  async function refreshStockAnalysis() {
    await Promise.all([reloadStock(), refresh()]);
  }

  return (
    <main className="app-main">
      <div className="page stock-analysis-page" id="stock-analysis">
        <div className="stock-analysis-left">
          <div className="stock-analysis-back-row">
            <AppButton variant="secondary" icon={ArrowLeft} className="stock-back-button" onClick={onBack}>{backLabel}</AppButton>
            <UpdateBar
              dateTime={market?.overview?.snapshot?.asOf}
              ariaLabel="Refresh stock analysis"
              onRefresh={refreshStockAnalysis}
              busy={stockRefreshing}
              className="stock-analysis-update"
            />
          </div>
          <header className="stock-profile">
            <Mascot variant="mint" color="var(--color-mint)" size={78} rotation={-3} eyes={{ x1: 44, y1: 48, x2: 58, y2: 48 }} />
            <div className="stock-profile__copy">
              <p className="eyebrow stock-profile__eyebrow">Stock Analysis</p>
              <div className="stock-profile__title-row"><h1 title={stock?.company ?? ticker}>{stock?.company ?? ticker}</h1><span className="stock-ticker-pill">{ticker}</span></div>
              <p>
                {stock
                  ? <>{stock.exchange}<span aria-hidden="true"> · </span>{stock.sector}</>
                  : staticMode && stockStatus === "error" ? "No published data for this symbol" : stockStatus === "error" ? "Symbol not available" : summaryState === "loading" ? "Loading verified data…" : "No verified data"}
              </p>
            </div>
            <div className="stock-profile__art" aria-hidden="true"><MascotDuo creamColor="var(--color-surface)" /></div>
          </header>

          <section className="stock-price-summary" aria-label={`${ticker} price summary`}>
            <strong className="stock-price-summary__price">
              {summaryState === "loading"
                ? <Skeleton width="170px" height="0.72em" />
                : stock ? formatMoney(stock.price) : "—"}
            </strong>
            <span className={`stock-price-change ${stock ? ((stock.change ?? 0) >= 0 ? "is-positive" : "is-negative") : "is-unavailable"}`}>
              {summaryState === "loading"
                ? <Skeleton width="118px" height="14px" />
                : stock ? <>{stock.changeAbsolute > 0 ? "+" : stock.changeAbsolute < 0 ? "−" : ""}{formatMoney(Math.abs(stock.changeAbsolute))} ({signedPercent(stock.change, 2)})</> : "—"}
            </span>
            <span className="stock-price-summary__divider" aria-hidden="true" />
            <span className="stock-market-cap">
              <Stack size={24} weight="regular" aria-hidden="true" />
              <span className="stock-market-cap__copy">
                <span className="stock-market-cap__label">Market Cap</span>
                <strong className="stock-market-cap__value">
                  {summaryState === "loading"
                    ? <Skeleton width="82px" height="13px" />
                    : formatMarketCap(stock?.marketCap)}
                </strong>
              </span>
            </span>
            <span className="stock-price-summary__divider stock-price-summary__divider--last" aria-hidden="true" />
            <span className={`stock-rank-pill stock-rank-pill--${rankTier}`}>
              {stock?.rank === 1 && <CrownSimple size={24} weight="fill" aria-hidden="true" />}
              {summaryState === "loading"
                ? <Skeleton width="82px" height="14px" />
                : <strong>Rank #{stock?.rank ?? "—"}</strong>}
            </span>
          </section>

          <section className="dashboard-card stock-price-card" aria-label={`${ticker} historical price chart`}>
            <div className="stock-price-controls">
              <div className="stock-price-toolbar" role="group" aria-label="Stock price history range">
                {priceRanges.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}
              </div>
              <button
                type="button"
                className="stock-price-scale-toggle"
                aria-pressed={logScale}
                aria-label="Logarithmic price scale"
                onClick={() => setLogScale((current) => !current)}
              >
                <span>Log Scale</span>
                <span className="stock-switch" aria-hidden="true"><i /></span>
              </button>
            </div>
            <div className="stock-price-chart-wrap">
              {priceState === "ready"
                ? <PriceChart stock={stock} range={range} logScale={logScale} />
                : (
                  <ChartState
                    state={priceState}
                    title={priceState === "error" ? "Price history unavailable" : "No price history"}
                    detail={priceState === "error"
                      ? `No verified market data could be loaded for ${ticker}. Pick another symbol or retry the update.`
                      : `No verified price observations are available for ${ticker}.`}
                    className="stock-price-chart-pending"
                  />
                )}
            </div>
          </section>

          <section className="stock-returns-card" aria-label="Historical price returns" data-state={returnsState} aria-busy={returnsState === "loading" || undefined}>
            {["1M Return", "3M Return", "6M Return", "12M Price Return"].map((label, index) => {
              const value = returnRows[index]?.[1];
              return (
                <div className="stock-return" key={label}>
                  <span>{label}</span>
                  {returnsState === "loading" ? (
                    <Skeleton width="82%" height="24px" />
                  ) : (
                    <strong className={typeof value === "number" ? (value >= 0 ? "is-positive" : "is-negative") : "is-unavailable"}>{signedPercent(value)}</strong>
                  )}
                  {index < 3 && <i aria-hidden="true" />}
                </div>
              );
            })}
          </section>
        </div>

        <div className="stock-analysis-right">
          <DashboardCard title="Momentum Analysis" className="stock-momentum-card">
            <div className="stock-momentum-score">
              <Stack size={29} weight="regular" aria-hidden="true" />
              <div className="stock-momentum-score__copy">
                <span>Momentum Score</span>
                <strong>{summaryState === "loading" ? <Skeleton width="105px" height="0.62em" /> : stock ? stock.score.toFixed(2) : "—"}</strong>
              </div>
              <Mascot className="stock-momentum-score__cream" variant="cream" color="var(--color-surface)" size={148} rotation={2} eyes={{ x1: 45, y1: 46, x2: 58, y2: 46 }} />
              <Mascot className="stock-momentum-score__pink" variant="pink" color="var(--color-pink)" size={115} rotation={-6} />
            </div>
            <div className="stock-momentum-metrics">
              <div className="stock-metric-row"><ChartBar size={25} weight="regular" aria-hidden="true" /><span>12–1 Momentum</span><strong>{summaryState === "loading" ? <Skeleton width="68px" height="13px" /> : stock ? signedPercent(stock.momentum) : "—"}</strong></div>
              <div className="stock-metric-row"><Scales size={25} weight="regular" aria-hidden="true" /><span>Risk-Adjusted Momentum</span><strong>{summaryState === "loading" ? <Skeleton width="58px" height="13px" /> : stock ? stock.riskAdjusted.toFixed(2) : "—"}</strong></div>
              <div className="stock-metric-row"><Sigma size={25} weight="regular" aria-hidden="true" /><span>Z-Score</span><strong>{summaryState === "loading" ? <Skeleton width="58px" height="13px" /> : stock ? stock.zScore.toFixed(2) : "—"}</strong></div>
            </div>
          </DashboardCard>

          <DashboardCard title="Ranking History" className="stock-ranking-card">
            <div className="stock-ranking-legend" aria-label="Ranking history series">
              <span><i className="stock-ranking-legend__rank" aria-hidden="true" />Rank</span>
              <span><i className="stock-ranking-legend__score" aria-hidden="true" />Momentum Score</span>
            </div>
            {stock?.history?.length
              ? <RankingHistoryChart stock={stock} />
              : (
                <ChartState
                  state={rankingState}
                  title={rankingState === "error" ? "Ranking history unavailable" : "No ranking history"}
                  detail={rankingState === "error"
                    ? "The latest verified rank history could not be loaded."
                    : "Monthly rank history appears after verified snapshots are available."}
                  className="stock-ranking-chart-pending"
                />
              )}
          </DashboardCard>
        </div>
      </div>
      {showStockError && (
        <Toast
          kind="error"
          message="Stock data update failed"
          className="page-toast"
          onDismiss={() => setStockErrorDismissed(true)}
          action={<button type="button" className="notification-toast__action" onClick={reloadStock}>Retry</button>}
        />
      )}
    </main>
  );
}

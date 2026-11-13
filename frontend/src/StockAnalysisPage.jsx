import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChartBar, CrownSimple, Scales, Sigma, Stack } from "@phosphor-icons/react";
import { AppButton } from "./components/AppButton.jsx";
import { DashboardCard } from "./components/DashboardCard.jsx";
import { Mascot, MascotDuo } from "./components/Mascot.jsx";
import { useElementSize } from "./components/useElementSize.js";
import { useMediaQuery } from "./components/useMediaQuery.js";
import { useMarket, useStockDetail } from "./api/MarketProvider.jsx";
import { formatMarketCap } from "./utils/format.js";
import {
  PRICE_TOOLTIP_HEIGHT,
  PRICE_TOOLTIP_WIDTH,
  formatTooltipDate,
  nearestObservationIndex,
  placePriceTooltip,
  sideForMovement,
} from "./utils/priceTooltip.js";
import { getRankTier } from "./utils/rankTier.js";

const priceRanges = ["1M", "3M", "6M", "12M"];
const monthsBack = { "1M": 1, "3M": 3, "6M": 6, "12M": 12 };

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

function PriceTooltipContent({ date, price, change, compact = false }) {
  const tone = typeof change === "number" && change > 0
    ? "positive"
    : typeof change === "number" && change < 0
      ? "negative"
      : "neutral";
  return (
    <div className={`stock-price-tooltip${compact ? " stock-price-tooltip--mobile" : ""}`} role="tooltip">
      <span className="stock-price-tooltip__date">{formatTooltipDate(date)}</span>
      <strong className="stock-price-tooltip__price">{formatMoney(price)}</strong>
      <span className={`stock-price-tooltip__change is-${tone}`}>{signedPercent(change, 2)}</span>
    </div>
  );
}

function monthlyTicks(dates) {
  // One tick per calendar month, taken at the first observation of that month.
  const ticks = [];
  let lastKey = "";
  dates.forEach((iso, index) => {
    const key = iso.slice(0, 7);
    if (key === lastKey) return;
    lastKey = key;
    const date = new Date(`${iso}T00:00:00`);
    ticks.push({
      index,
      label: date.toLocaleDateString("en-US", { month: "short" }),
      year: date.getFullYear(),
    });
  });
  return ticks;
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

function PriceChart({ stock, range }) {
  const [boxRef, box] = useElementSize();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [tooltipSide, setTooltipSide] = useState("left");
  const movementOriginX = useRef(Number.NaN);
  const touchStart = useRef(null);
  const stableTouchDetail = useMediaQuery("(max-width: 680px), (hover: none), (pointer: coarse)");
  const history = stock.priceHistory;
  const total = history.values.length;
  const months = monthsBack[range];
  const startIndex = Math.max(0, Math.round(total - (months / 12) * (total - 1)));
  const visible = history.values.slice(startIndex);
  const visibleDates = history.dates.slice(startIndex);
  const observationDates = (history.observationDates ?? history.dates).slice(startIndex);
  const dailyChanges = (history.dailyChanges ?? []).slice(startIndex);
  const axis = getPriceTicks(visible);

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

  const points = visible.map((value, index) => ({
    x: plot.left + (index / Math.max(1, visible.length - 1)) * plot.width,
    y: plot.top + ((axis.max - value) / (axis.max - axis.min)) * plot.height,
  }));
  const line = smoothPath(points);
  const area = points.length
    ? `${line} L ${points.at(-1).x} ${plot.top + plot.height} L ${points[0].x} ${plot.top + plot.height} Z`
    : "";
  const ticks = monthlyTicks(visibleDates);

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
  }, [range, stock.ticker]);

  const activeIndex = selectedIndex != null && selectedIndex < points.length ? selectedIndex : null;
  const selectedPoint = activeIndex == null ? null : points[activeIndex];
  const tooltipPlacement = selectedPoint
    ? placePriceTooltip({
      anchorX: selectedPoint.x,
      anchorY: selectedPoint.y,
      preferredSide: tooltipSide,
      containerWidth: width,
      containerHeight: height,
      tooltipWidth: PRICE_TOOLTIP_WIDTH,
      tooltipHeight: PRICE_TOOLTIP_HEIGHT,
    })
    : null;

  function selectPointerPosition(clientX) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return;
    const pointerX = Math.min(Math.max(clientX - rect.left, plot.left), plotRight);
    setSelectedIndex(nearestObservationIndex(points, pointerX));
  }

  function handlePointerMove(event) {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      const start = touchStart.current;
      if (start && start.pointerId === event.pointerId
        && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
        touchStart.current = null;
      }
      return;
    }
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = event.clientX - rect.left;
    const nextMovement = sideForMovement({
      pointerX,
      movementOriginX: movementOriginX.current,
      currentSide: tooltipSide,
    });
    movementOriginX.current = nextMovement.movementOriginX;
    if (nextMovement.side !== tooltipSide) setTooltipSide(nextMovement.side);
    selectPointerPosition(event.clientX);
  }

  function handlePointerLeave(event) {
    if (stableTouchDetail && (event.pointerType === "touch" || event.pointerType === "pen")) return;
    setSelectedIndex(null);
    movementOriginX.current = Number.NaN;
  }

  function handlePointerDown(event) {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      touchStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    }
  }

  function handlePointerUp(event) {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const start = touchStart.current;
    touchStart.current = null;
    if (start && start.pointerId === event.pointerId
      && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) {
      selectPointerPosition(event.clientX);
    }
  }

  function handlePointerCancel() {
    touchStart.current = null;
  }

  return (
    <div
      className="stock-price-chart-canvas"
      ref={boxRef}
      data-testid="stock-price-chart"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {ready && (
        <svg
          className="stock-price-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${stock.ticker} adjusted close over ${range}`}
        >
          <defs>
            <linearGradient id={`price-fill-${stock.ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFE59A" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#FFE59A" stopOpacity="0.035" />
            </linearGradient>
          </defs>
          {Array.from({ length: compact ? 4 : 6 }, (_, index) => axis.min + (axis.max - axis.min) * index / (compact ? 3 : 5)).map((tick) => {
            const y = plot.top + ((axis.max - tick) / (axis.max - axis.min)) * plot.height;
            return <g key={tick}><line x1={plot.left} x2={plotRight} y1={y} y2={y} className="stock-chart-gridline" /><text x={plot.left - 10} y={y + 5} textAnchor="end" className="stock-chart-axis-label">${Math.round(tick)}</text></g>;
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
            style={{ left: tooltipPlacement.x, top: tooltipPlacement.y }}
            data-side={tooltipPlacement.side}
            data-testid="stock-price-tooltip"
          >
            <PriceTooltipContent
              date={observationDates[activeIndex] ?? visibleDates[activeIndex]}
              price={visible[activeIndex]}
              change={dailyChanges[activeIndex]}
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
  const tooltipPlacement = selectedPoint
    ? placePriceTooltip({
      anchorX: selectedPoint.x,
      anchorY: top + plotHeight / 2,
      preferredSide: tooltipSide,
      containerWidth: width,
      containerHeight: height,
      tooltipWidth: 210,
      tooltipHeight: 102,
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

  return (
    <div
      className="ranking-chart-canvas"
      ref={boxRef}
      onPointerMove={(event) => {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") selectAt(event.clientX);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch" || event.pointerType === "pen") return;
        setSelectedIndex(null);
        movementOriginX.current = Number.NaN;
        tooltipSideRef.current = null;
        setTooltipSide(null);
      }}
      onPointerDown={(event) => selectAt(event.clientX)}
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
          style={{ left: tooltipPlacement.x, top: tooltipPlacement.y }}
          data-testid="ranking-history-tooltip"
        >
          <div className="backtest-chart-tooltip backtest-chart-tooltip--compact" role="tooltip">
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
  const { data: stock, status, error } = useStockDetail(ticker);
  const { data: market, staticMode } = useMarket();
  const [range, setRange] = useState("12M");

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

  return (
    <main className="app-main">
      <div className="page stock-analysis-page" id="stock-analysis">
        <div className="stock-analysis-left">
          <div className="stock-analysis-back-row">
            <AppButton variant="secondary" icon={ArrowLeft} className="stock-back-button" onClick={onBack}>{backLabel}</AppButton>
          </div>
          <header className="stock-profile">
            <Mascot variant="mint" color="var(--color-mint)" size={78} rotation={-3} eyes={{ x1: 44, y1: 48, x2: 58, y2: 48 }} />
            <div className="stock-profile__copy">
              <p className="eyebrow stock-profile__eyebrow">Stock Analysis</p>
              <div className="stock-profile__title-row"><h1 title={stock?.company ?? ticker}>{stock?.company ?? ticker}</h1><span className="stock-ticker-pill">{ticker}</span></div>
              <p>
                {stock
                  ? <>{stock.exchange}<span aria-hidden="true"> · </span>{stock.sector}</>
                  : staticMode ? "Static preview — no live data" : status === "error" ? "Symbol not available" : "Loading verified data…"}
              </p>
            </div>
            <div className="stock-profile__art" aria-hidden="true"><MascotDuo creamColor="var(--color-surface)" /></div>
          </header>

          <section className="stock-price-summary" aria-label={`${ticker} price summary`}>
            <strong className="stock-price-summary__price">{stock ? formatMoney(stock.price) : "—"}</strong>
            <span className={`stock-price-change ${(stock?.change ?? 0) >= 0 ? "is-positive" : "is-negative"}`}>
              {stock ? <>{stock.changeAbsolute > 0 ? "+" : stock.changeAbsolute < 0 ? "−" : ""}{formatMoney(Math.abs(stock.changeAbsolute))} ({signedPercent(stock.change, 2)})</> : "—"}
            </span>
            <span className="stock-price-summary__divider" aria-hidden="true" />
            <span className="stock-market-cap">
              <Stack size={24} weight="regular" aria-hidden="true" />
              <span className="stock-market-cap__copy">
                <span className="stock-market-cap__label">Market Cap</span>
                <strong className="stock-market-cap__value">{formatMarketCap(stock?.marketCap)}</strong>
              </span>
            </span>
            <span className="stock-price-summary__divider stock-price-summary__divider--last" aria-hidden="true" />
            <span className={`stock-rank-pill stock-rank-pill--${rankTier}`}>{stock?.rank === 1 && <CrownSimple size={24} weight="fill" aria-hidden="true" />}<strong>Rank #{stock?.rank ?? "—"}</strong></span>
          </section>

          <section className="dashboard-card stock-price-card" aria-label={`${ticker} historical price chart`}>
            <div className="stock-price-toolbar" role="group" aria-label="Stock price history range">
              {priceRanges.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}
            </div>
            <div className="stock-price-chart-wrap">
              {stock?.priceHistory?.values?.length
                ? <PriceChart stock={stock} range={range} />
                : (
                  <div className="stock-chart-pending" role="status">
                    {status === "error"
                      ? <>No verified market data for <strong>{ticker}</strong>.<span>Pick another symbol from the Screener.</span></>
                      : "Loading verified price history…"}
                  </div>
                )}
            </div>
          </section>

          <section className="stock-returns-card" aria-label="Historical price returns" hidden={!returnRows.length}>
            {returnRows.map(([label, value], index) => <div className="stock-return" key={label}>
              <span>{label}</span><strong className={value >= 0 ? "is-positive" : "is-negative"}>{signedPercent(value)}</strong>
              {index < returnRows.length - 1 && <i aria-hidden="true" />}
            </div>)}
          </section>
        </div>

        <div className="stock-analysis-right">
          <DashboardCard title="Momentum Analysis" className="stock-momentum-card">
            <div className="stock-momentum-score">
              <Stack size={29} weight="regular" aria-hidden="true" />
              <div className="stock-momentum-score__copy"><span>Momentum Score</span><strong>{stock ? stock.score.toFixed(2) : "—"}</strong></div>
              <Mascot className="stock-momentum-score__cream" variant="cream" color="var(--color-surface)" size={148} rotation={2} eyes={{ x1: 45, y1: 46, x2: 58, y2: 46 }} />
              <Mascot className="stock-momentum-score__pink" variant="pink" color="var(--color-pink)" size={115} rotation={-6} />
            </div>
            <div className="stock-momentum-metrics">
              <div className="stock-metric-row"><ChartBar size={25} weight="regular" aria-hidden="true" /><span>12–1 Momentum</span><strong>{stock ? signedPercent(stock.momentum) : "—"}</strong></div>
              <div className="stock-metric-row"><Scales size={25} weight="regular" aria-hidden="true" /><span>Risk-Adjusted Momentum</span><strong>{stock ? stock.riskAdjusted.toFixed(2) : "—"}</strong></div>
              <div className="stock-metric-row"><Sigma size={25} weight="regular" aria-hidden="true" /><span>Z-Score</span><strong>{stock ? stock.zScore.toFixed(2) : "—"}</strong></div>
            </div>
          </DashboardCard>

          <DashboardCard title="Ranking History" className="stock-ranking-card">
            <div className="stock-ranking-legend" aria-label="Ranking history series">
              <span><i className="stock-ranking-legend__rank" aria-hidden="true" />Rank (Left)</span>
              <span><i className="stock-ranking-legend__score" aria-hidden="true" />Momentum Score (Right)</span>
            </div>
            {stock?.history?.length
              ? <RankingHistoryChart stock={stock} />
              : <div className="stock-chart-pending" role="status">Monthly rank history builds from provider data…</div>}
          </DashboardCard>
        </div>
      </div>
    </main>
  );
}

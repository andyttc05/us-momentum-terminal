import { useEffect, useRef, useState } from "react";
import { useElementSize } from "./useElementSize.js";
import { createDateScale, placeTicks } from "../utils/timeAxis.js";
import {
  formatTooltipDate,
  nearestObservationIndex,
  placePriceTooltip,
  sideForMovement,
} from "../utils/priceTooltip.js";

// Series points and x-axis labels share one x coordinate list. The list comes
// from the sample dates when the payload carries them, because plotting by
// array index would stretch a partial first month into a full month's slot.
function seriesPoints(values, xs, axis, top, height) {
  const span = axis.max - axis.min || 1;
  return values.map((value, index) => ({
    x: xs[index] ?? xs[xs.length - 1] ?? 0,
    y: top + ((axis.max - value) / span) * height,
  }));
}

function linePath(points) {
  if (points.length < 2) return "";

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const beforePrevious = points[index - 2] ?? previous;
    const next = points[index + 1] ?? point;
    const control1X = previous.x + (point.x - beforePrevious.x) / 6;
    const control1Y = previous.y + (point.y - beforePrevious.y) / 6;
    const control2X = point.x - (next.x - previous.x) / 6;
    const control2Y = point.y - (next.y - previous.y) / 6;
    return `${path} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${point.x} ${point.y}`;
  }, "");
}

// Short connector from a series endpoint to its value pill: a straight stub
// when the pill already sits on the endpoint, a single soft curve otherwise.
function leaderPath(startX, startY, pillX, labelY) {
  const dy = labelY - startY;
  if (Math.abs(dy) < 1) return `M ${startX} ${startY} L ${pillX - 1} ${startY}`;
  const midX = startX + (pillX - 1 - startX) * 0.55;
  return `M ${startX} ${startY} C ${midX} ${startY} ${midX} ${labelY} ${pillX - 1} ${labelY}`;
}

function axisLabel(value) {
  if (value === 0) return "0%";
  return `${value < 0 ? "−" : "+"}${Math.abs(value)}%`;
}

function areaPath(points, left, right, bottom) {
  const line = linePath(points);
  if (!line) return "";
  return `${line} L ${right} ${bottom} L ${left} ${bottom} Z`;
}

export function PerformanceChart({ period, data }) {
  // The chart draws itself at 1:1 inside its measured box, so it uses the
  // space the card actually has instead of a fixed aspect ratio that either
  // letterboxes or gets stretched.
  const [boxRef, box] = useElementSize();
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [tooltipSide, setTooltipSide] = useState(null);
  const movementOriginX = useRef(Number.NaN);
  const tooltipSideRef = useRef(null);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const ready = width > 0 && height > 0;

  // Phones get their own configuration: the endpoint callouts are dropped so
  // the plot can use the full width, and fewer axis labels are drawn.
  const compact = width > 0 && width < 520;
  const left = compact ? 40 : 52;
  const top = compact ? 10 : 14;
  // The plot stops before the right edge so the leader lines get a real
  // horizontal runway before the value pills instead of a cramped 9px.
  const plotWidth = Math.max(80, width - left - (compact ? 10 : 92));
  const plotHeight = Math.max(80, height - top - (compact ? 26 : 32));
  const plotRight = left + plotWidth;
  const labelGap = 26;
  const labelMinY = top + 13;
  const labelMaxY = top + plotHeight - 13;
  const pillWidth = 82;
  const pillHeight = 22;
  const pillRadius = pillHeight / 2;
  const pillX = plotRight + 12;
  // The endpoint dot is r=4 with a 2px ring, so its outer edge sits at +5.
  const leaderStartX = plotRight + 5;

  // --- Horizontal scale ---------------------------------------------------- //
  // One mapping for the whole chart: series points and month labels both ask
  // the same function where a date belongs. The x axis is a time axis, so a
  // window opening mid-month gives that partial month only its real share
  // instead of a full month's slot.
  const pointCount = data.series[0]?.values?.length ?? 0;
  const pointDates = Array.isArray(data.dates) && data.dates.length === pointCount ? data.dates : null;
  const dateFraction = createDateScale(pointDates);
  const seriesXs = (count) => {
    if (count < 2) return [left];
    if (dateFraction && count === pointDates.length) {
      return pointDates.map((stamp) => left + (dateFraction(stamp) ?? 0) * plotWidth);
    }
    return Array.from({ length: count }, (_, index) => left + (index / (count - 1)) * plotWidth);
  };

  // Ticks arrive already dated (calendar month ends). Older cached snapshots
  // only carry positional labels, so those keep index placement as a fallback.
  const tickSpecs = Array.isArray(data.ticks) && data.ticks.length
    ? data.ticks
    : (data.labels ?? []).map((label, index) => ({ label, index }));
  const xForTick = (spec) => {
    if (spec.date) {
      const fraction = dateFraction?.(spec.date);
      if (typeof fraction !== "number") return null;
      const x = left + fraction * plotWidth;
      return x < left - 0.5 || x > plotRight + 0.5 ? null : x;
    }
    if (typeof spec.index === "number" && tickSpecs.length > 1) {
      return left + (spec.index / (tickSpecs.length - 1)) * plotWidth;
    }
    return null;
  };
  // Labels are only dropped when they would collide or leave the canvas — they
  // are never nudged sideways, so one interval can't end up twice as wide.
  const xTicks = placeTicks(tickSpecs, {
    xFor: xForTick,
    width,
    charWidth: (compact ? 10 : 12) * 0.56,
    gap: compact ? 6 : 10,
  });
  const plotted = data.series.map((series) => ({
    series,
    points: seriesPoints(series.values, seriesXs(series.values.length), data.axis, top, plotHeight),
  }));
  const primaryPoints = plotted[0]?.points ?? [];
  const selectedPoint = selectedIndex == null ? null : primaryPoints[selectedIndex];
  const tooltipPlacement = selectedPoint
    ? placePriceTooltip({
      anchorX: selectedPoint.x,
      anchorY: selectedPoint.y,
      preferredSide: tooltipSide,
      containerWidth: width,
      containerHeight: height,
      tooltipWidth: compact ? 196 : 222,
      tooltipHeight: compact ? 118 : 128,
    })
    : null;

  useEffect(() => {
    setSelectedIndex(null);
    setTooltipSide(null);
    movementOriginX.current = Number.NaN;
    tooltipSideRef.current = null;
  }, [period, data]);

  function selectAt(clientX) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !primaryPoints.length) return;
    const pointerX = Math.min(Math.max(clientX - rect.left, left), plotRight);
    const nextSide = sideForMovement({
      pointerX,
      movementOriginX: movementOriginX.current,
      currentSide: tooltipSideRef.current,
    });
    movementOriginX.current = nextSide.movementOriginX;
    tooltipSideRef.current = nextSide.side;
    setTooltipSide(nextSide.side);
    setSelectedIndex(nearestObservationIndex(primaryPoints, pointerX));
  }

  function handleLeave(event) {
    if (event.pointerType === "touch" || event.pointerType === "pen") return;
    setSelectedIndex(null);
    movementOriginX.current = Number.NaN;
    tooltipSideRef.current = null;
    setTooltipSide(null);
  }

  const endLabels = data.series
    .map((series) => ({
      series,
      endY: top + ((data.axis.max - series.values.at(-1)) / (data.axis.max - data.axis.min)) * plotHeight,
    }))
    .sort((a, b) => a.endY - b.endY);

  // Each pill tries to sit at its own endpoint's height. Only endpoints that
  // would physically overlap are grouped into a tight cluster, so a distant
  // series keeps a short straight connector instead of a long detour.
  const clusters = [];
  endLabels.forEach((item) => {
    const current = clusters[clusters.length - 1];
    if (current && item.endY - current[current.length - 1].endY < labelGap) current.push(item);
    else clusters.push([item]);
  });
  clusters.forEach((cluster) => {
    const span = (cluster.length - 1) * labelGap;
    const centre = cluster.reduce((total, item) => total + item.endY, 0) / cluster.length;
    const first = Math.min(Math.max(centre - span / 2, labelMinY), labelMaxY - span);
    cluster.forEach((item, index) => {
      item.labelY = first + index * labelGap;
    });
  });

  return (
    <div className="performance-chart">
      <div
        className="performance-chart__canvas"
        ref={boxRef}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch" && event.pointerType !== "pen") selectAt(event.clientX);
        }}
        onPointerLeave={handleLeave}
        onPointerDown={(event) => selectAt(event.clientX)}
      >
      {ready && (
      <svg
        className="performance-chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${period} performance chart for Strategy, SPY, and SPMO`}
      >
        <defs>
          {data.series.map((series) => (
            <linearGradient id={`area-${series.id}`} key={series.id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.color} stopOpacity="0.12" />
              <stop offset="100%" stopColor={series.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {(compact ? data.axis.ticks.filter((_, index) => index % 2 === 0) : data.axis.ticks).map((tick) => {
          const y = top + ((data.axis.max - tick) / (data.axis.max - data.axis.min)) * plotHeight;
          return (
            <g key={tick}>
              <line x1={left} x2={left + plotWidth} y1={y} y2={y} className="performance-chart__gridline" />
              <text x={left - 10} y={y + 4} textAnchor="end" className="performance-chart__axis-label">{axisLabel(tick)}</text>
            </g>
          );
        })}
        {xTicks.map((tick) => (
          <text
            key={`tick-${tick.date ?? tick.index}`}
            x={tick.x}
            y={top + plotHeight + (compact ? 18 : 26)}
            textAnchor="middle"
            data-date={tick.date ?? undefined}
            className="performance-chart__axis-label performance-chart__x-axis-label"
          >{tick.label}</text>
        ))}
        <line x1={left} x2={left} y1={top} y2={top + plotHeight} className="performance-chart__gridline" />
        {plotted.map(({ series, points }) => (
          <path key={`${series.id}-area`} d={areaPath(points, left, plotRight, top + plotHeight)} fill={`url(#area-${series.id})`} />
        ))}
        {plotted.map(({ series, points }) => (
          <path key={series.id} d={linePath(points)} className={`performance-chart__line performance-chart__line--${series.id}`} />
        ))}
        {selectedPoint && (
          <g data-testid="performance-chart-selection">
            <line x1={selectedPoint.x} x2={selectedPoint.x} y1={top} y2={top + plotHeight} className="backtest-crosshair" />
            {plotted.map(({ series, points }) => {
              const point = points[selectedIndex];
              return point ? <circle key={series.id} cx={point.x} cy={point.y} r="4.5" className={`backtest-hover-point backtest-hover-point--${series.id}`} /> : null;
            })}
          </g>
        )}
        {!compact && endLabels.map(({ series, endY, labelY }) => (
          <g key={`${series.id}-label`}>
            <circle cx={plotRight} cy={endY} r="4" className={`performance-chart__endpoint performance-chart__endpoint--${series.id}`} />
            <path
              d={leaderPath(leaderStartX, endY, pillX, labelY, pillRadius)}
              className={`performance-chart__leader performance-chart__leader--${series.id}`}
            />
            <rect x={pillX} y={labelY - pillRadius} width={pillWidth} height={pillHeight} rx={pillRadius} className={`performance-chart__value-pill performance-chart__value-pill--${series.id}`} />
            <text x={pillX + pillWidth / 2} y={labelY} dominantBaseline="central" textAnchor="middle" className="performance-chart__value-label">{series.end}</text>
          </g>
        ))}
      </svg>
      )}
      {ready && selectedPoint && (
        <div
          className="backtest-floating-tooltip"
          style={{ left: tooltipPlacement.x, top: tooltipPlacement.y }}
          data-testid="performance-chart-tooltip"
        >
          <div className="backtest-chart-tooltip" role="tooltip">
            <span className="backtest-chart-tooltip__date">{formatTooltipDate(data.dates?.[selectedIndex])}</span>
            {data.series.map((series) => {
              const value = series.values[selectedIndex];
              const tone = value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
              return (
                <span className="backtest-chart-tooltip__row" key={series.id}>
                  <i style={{ "--series-color": series.color }} aria-hidden="true" />
                  <span>{series.name}</span>
                  <strong className={`is-${tone}`}>{`${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`}</strong>
                </span>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

import { useElementSize } from "./useElementSize.js";

function linePath(values, axis, left, top, width, height) {
  const points = values.map((value, index) => ({
    x: left + (index / (values.length - 1)) * width,
    y: top + ((axis.max - value) / (axis.max - axis.min)) * height,
  }));

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

function areaPath(values, axis, left, top, width, height) {
  const bottom = top + height;
  const line = linePath(values, axis, left, top, width, height);
  const right = left + width;
  return `${line} L ${right} ${bottom} L ${left} ${bottom} Z`;
}

export function PerformanceChart({ period, data }) {
  // The chart draws itself at 1:1 inside its measured box, so it uses the
  // space the card actually has instead of a fixed aspect ratio that either
  // letterboxes or gets stretched.
  const [boxRef, box] = useElementSize();
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
      <div className="performance-chart__canvas" ref={boxRef}>
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
        {data.labels.map((label, index) => {
          const x = left + (index / (data.labels.length - 1)) * plotWidth;
          // Phones only label every other month so the axis stays readable.
          if (compact && index % 2 !== 0) return null;
          return <text key={`tick-${index}`} x={x} y={top + plotHeight + (compact ? 18 : 26)} textAnchor="middle" data-index={index} className="performance-chart__axis-label performance-chart__x-axis-label">{label}</text>;
        })}
        <line x1={left} x2={left} y1={top} y2={top + plotHeight} className="performance-chart__gridline" />
        {data.series.map((series) => (
          <path key={`${series.id}-area`} d={areaPath(series.values, data.axis, left, top, plotWidth, plotHeight)} fill={`url(#area-${series.id})`} />
        ))}
        {data.series.map((series) => (
          <path key={series.id} d={linePath(series.values, data.axis, left, top, plotWidth, plotHeight)} className={`performance-chart__line performance-chart__line--${series.id}`} />
        ))}
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
      </div>
    </div>
  );
}

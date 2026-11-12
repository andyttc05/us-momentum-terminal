/**
 * The one canonical 12-1 momentum series for the Screener sparkline.
 *
 * The server owns the calculation. `sparkline12_1` is sliced from the exact
 * same adjusted closes as the headline momentum — P(t-21) / P(t-252) - 1 — and
 * is indexed to 100 at the first observation of that window. The last month is
 * excluded because the window ends 21 sessions before the latest close.
 *
 * Nothing here recalculates a series. This module only reads that payload,
 * validates it, and projects it into a drawing box, so any chart that renders
 * the momentum path is guaranteed to show the same numbers and the same curve.
 *
 * Vertical scale: indexed price paths are plotted logarithmically. An equal
 * percentage move always occupies an equal amount of height, whatever the price
 * level, so a stock's real fluctuations stay visible while the gap between a
 * +40% and a +280% path stays honest. The domain is computed once from the
 * whole universe and passed in, so every row shares one scale and filtering the
 * table can never rescale a sparkline.
 */

export const MOMENTUM_BASE_INDEX = 100;

// The miniature keeps the Screener's existing 100 x 26 drawing box.
const SPARKLINE_BOX = { left: 0, top: 2, width: 100, height: 22 };

function readSeries(stock) {
  const raw = stock?.sparkline12_1;
  const values = Array.isArray(raw?.values) ? raw.values : null;
  if (!values || values.length < 2) return null;
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) return null;
  }
  return raw;
}

/** The validated indexed series for one ticker, or [] when the row has none. */
export function momentumSeriesValues(stock) {
  return readSeries(stock)?.values ?? [];
}

/** Series plus its provenance, for charts that need the window labels. */
export function momentumSeries(stock) {
  const raw = readSeries(stock);
  if (!raw) return null;
  return {
    ticker: stock?.ticker ?? null,
    values: raw.values,
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    startAdjustedClose: raw.startAdjustedClose ?? null,
    endAdjustedClose: raw.endAdjustedClose ?? null,
    returnPct: raw.returnPct ?? null,
    firstIndex: raw.values[0],
    lastIndex: raw.values.at(-1),
  };
}

/**
 * One shared vertical domain for the whole eligible universe.
 *
 * It is computed from every stock in the snapshot, never from the visible page,
 * so sorting, searching, filtering and pagination can move a row around without
 * changing its scale. The base of 100 is always inside the domain.
 */
export function momentumSeriesDomain(stocks) {
  let low = Infinity;
  let high = -Infinity;
  for (const stock of stocks ?? []) {
    for (const value of momentumSeriesValues(stock)) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return { min: MOMENTUM_BASE_INDEX / 1.15, max: MOMENTUM_BASE_INDEX * 1.15 };
  }
  low = Math.min(low, MOMENTUM_BASE_INDEX);
  high = Math.max(high, MOMENTUM_BASE_INDEX);
  // Pad in log space so the most extreme paths never touch the frame.
  const logLow = Math.log(low);
  const logHigh = Math.log(high);
  const padding = Math.max((logHigh - logLow) * 0.04, 0.004);
  return { min: Math.exp(logLow - padding), max: Math.exp(logHigh + padding) };
}

function resolveDomain(values, domain) {
  if (Number.isFinite(domain?.min) && Number.isFinite(domain?.max) && domain.max > domain.min && domain.min > 0) {
    return domain;
  }
  // A chart must never render off an arbitrary scale if the shared domain has
  // not arrived yet: fall back to this series alone, same rule as the universe.
  let low = MOMENTUM_BASE_INDEX;
  let high = MOMENTUM_BASE_INDEX;
  for (const value of values ?? []) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const padding = Math.max((Math.log(high) - Math.log(low)) * 0.04, 0.004);
  return { min: Math.exp(Math.log(low) - padding), max: Math.exp(Math.log(high) + padding) };
}

/**
 * Project the indexed series into a box. The same function draws both sizes, so
 * two charts of the same stock always produce the same relative curve.
 */
export function momentumSeriesGeometry(values, domain, box = SPARKLINE_BOX) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const { min, max } = resolveDomain(values, domain);
  const logMin = Math.log(min);
  const logSpan = Math.log(max) - logMin || 1;
  const lastIndex = values.length - 1;
  return values.map((value, index) => {
    const bounded = Math.min(max, Math.max(min, value));
    return {
      x: box.left + (index / lastIndex) * box.width,
      y: box.top + (1 - (Math.log(bounded) - logMin) / logSpan) * box.height,
    };
  });
}

/** The same geometry as an SVG `points` string for the compact sparkline. */
export function momentumSeriesPoints(values, domain, box = SPARKLINE_BOX) {
  const points = momentumSeriesGeometry(values, domain, box);
  if (!points.length) return "";
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

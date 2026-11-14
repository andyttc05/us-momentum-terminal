/**
 * Axis scale for a wealth (dollar) series.
 *
 * Two modes, one contract: `{ min, max, ticks, log }` plus a position helper.
 * The log mode exists because a compounding curve squeezed into a linear axis
 * hides the first years, but a log axis is only readable when its *ticks* are
 * log-spaced too. Placing linear ticks on a logged plot bunches every label at
 * the top of the chart, which is the defect this module fixes.
 */

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** 1, 2, 5, 10, 20, 50 ... — the ladder a log axis is read in. */
const LOG_LADDER = [1, 2, 5];

function ladderFloor(value) {
  if (!(value > 0)) return 1;
  const decade = 10 ** Math.floor(Math.log10(value));
  let best = decade;
  LOG_LADDER.forEach((step) => {
    const candidate = step * decade;
    if (candidate <= value * (1 + 1e-12)) best = candidate;
  });
  return best;
}

function ladderCeil(value) {
  if (!(value > 0)) return 1;
  const decade = 10 ** Math.floor(Math.log10(value));
  let best = 10 * decade;
  for (let index = 0; index < LOG_LADDER.length; index += 1) {
    const candidate = LOG_LADDER[index] * decade;
    if (candidate >= value * (1 - 1e-12)) {
      best = candidate;
      break;
    }
  }
  return best;
}

/** Log-spaced ticks between two ladder points, thinned when there are too many. */
function logTicks(min, max) {
  const ticks = [];
  const firstDecade = Math.floor(Math.log10(min));
  const lastDecade = Math.ceil(Math.log10(max));
  for (let decade = firstDecade; decade <= lastDecade; decade += 1) {
    LOG_LADDER.forEach((step) => {
      const value = step * 10 ** decade;
      if (value >= min * (1 - 1e-9) && value <= max * (1 + 1e-9)) ticks.push(value);
    });
  }
  if (!ticks.length) return [min, max];
  if (ticks.length > 8) {
    // Every label would collide, so keep the decades only.
    const decades = ticks.filter((value) => {
      const mantissa = value / 10 ** Math.round(Math.log10(value));
      return Math.abs(mantissa - 1) < 1e-9;
    });
    return decades.length >= 2 ? decades : ticks;
  }
  return ticks;
}

/**
 * Linear dollar axis: zero-anchored, about four gridlines, rounded outward to a
 * 1/2/2.5/5/10 step so the labels stay readable at any account size.
 */
function linearScale(low, high) {
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
  return {
    min,
    max: Math.max(max, min + step),
    ticks: ticks.length ? ticks : [min],
    log: false,
  };
}

/**
 * @param {number[]} values dollar observations
 * @param {{ log?: boolean }} options
 */
export function buildWealthScale(values, { log = false } = {}) {
  const clean = (Array.isArray(values) ? values : []).filter(finite);
  const high = Math.max(0, ...clean);
  const low = Math.min(high, ...clean);
  if (!clean.length) return linearScale(0, 0);

  const positives = clean.filter((value) => value > 0);
  // One zero balance is enough to make the axis unloggable; the chart falls back
  // to linear rather than inventing a floor that would draw a fake crash.
  if (!log || positives.length !== clean.length) return linearScale(low, high);

  const min = ladderFloor(Math.min(...positives));
  let max = ladderCeil(high);
  if (max <= min) max = min * 10;
  return { min, max, ticks: logTicks(min, max), log: true };
}

/** True when the series can be drawn on a log axis at all. */
export function canLogScale(values) {
  const clean = (Array.isArray(values) ? values : []).filter(finite);
  return clean.length > 0 && clean.every((value) => value > 0);
}

/**
 * Vertical position of `value` inside a plot, in pixels from the top.
 * Values outside the scale are clamped so a single outlier cannot draw outside
 * the frame.
 */
export function wealthPosition(value, scale, top, plotHeight) {
  const span = scale.max - scale.min;
  if (!(span > 0)) return top + plotHeight;
  if (!scale.log) {
    const clamped = Math.min(scale.max, Math.max(scale.min, value));
    return top + (scale.max - clamped) / span * plotHeight;
  }
  const minimum = Math.log10(Math.max(scale.min, Number.MIN_VALUE));
  const maximum = Math.log10(scale.max);
  if (!(maximum > minimum)) return top + plotHeight;
  const clamped = Math.min(scale.max, Math.max(scale.min, value));
  return top + (maximum - Math.log10(clamped)) / (maximum - minimum) * plotHeight;
}

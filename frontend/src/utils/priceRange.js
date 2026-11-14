/**
 * Time ranges and axis helpers for the stock price chart.
 *
 * Ranges are calendar-day lookbacks measured against the last observation, so a
 * window can never be stretched by an index fraction, and the chart shows only
 * observations the source actually published: no interpolation and no
 * back-filled prices.
 */

export const DEFAULT_RANGE = "1Y";

export const priceRanges = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y", "ALL"];
// Calendar-day lookbacks. "ALL" has no cutoff: it shows every weekly sample the
// source actually published, which is the honest definition of "maximum
// available history".
export const rangeDays = {
  "1M": 31,
  "3M": 92,
  "6M": 183,
  "1Y": 366,
  "3Y": 1096,
  "5Y": 1827,
  "10Y": 3653,
  ALL: null,
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * First observation inside the requested window, found by date so a range can
 * never be stretched or compressed by an index fraction. Returns 0 when the
 * series does not reach back far enough — the chart then simply shows the
 * history that exists instead of inventing older prices.
 */
export function rangeStartIndex(dates, range) {
  const days = rangeDays[range];
  if (!days || !dates.length) return 0;
  const last = Date.parse(`${dates.at(-1)}T00:00:00`);
  const cutoff = last - days * 86_400_000;
  const index = dates.findIndex((iso) => Date.parse(`${iso}T00:00:00`) >= cutoff);
  return index <= 0 ? 0 : index;
}

/** Label density follows the window: months up to a year, then years. */
export function timeTicks(dates, range) {
  const dense = range === "1M" || range === "3M" || range === "6M" || range === "1Y";
  const byYear = range === "10Y" || range === "ALL";
  const ticks = [];
  let lastKey = "";
  dates.forEach((iso, index) => {
    const year = iso.slice(0, 4);
    const month = Number(iso.slice(5, 7));
    const key = byYear ? year : dense ? iso.slice(0, 7) : `${year}-Q${Math.ceil(month / 3)}`;
    if (key === lastKey) return;
    lastKey = key;
    const label = byYear
      ? year
      // Quarterly windows name the year on January so the reader never has to
      // count quarters to work out which year a label belongs to.
      : dense
        ? MONTH_LABELS[month - 1]
        : month === 1 ? year : MONTH_LABELS[month - 1];
    ticks.push({ index, label });
  });
  return ticks;
}


// A denser ladder than the money axis uses: a price series usually spans one or
// two decades, where 1/2/5 alone would leave two gridlines.
const PRICE_LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

function ladderStep(value, direction) {
  const decade = 10 ** Math.floor(Math.log10(value));
  const candidates = PRICE_LADDER.map((step) => step * decade);
  if (direction === "floor") {
    return candidates.filter((candidate) => candidate <= value * (1 + 1e-9)).at(-1) ?? decade;
  }
  return candidates.find((candidate) => candidate >= value * (1 - 1e-9)) ?? 10 * decade;
}

/**
 * Logarithmic price axis. Non-positive and non-finite values are excluded: a
 * price of zero or below has no logarithm, and clamping it would draw a fake
 * floor.
 */
export function priceLogAxis(values) {
  const clean = values.filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (!clean.length) return null;
  const min = ladderStep(Math.min(...clean), "floor");
  let max = ladderStep(Math.max(...clean), "ceil");
  if (!(max > min)) max = min * 1.5;
  const raw = [];
  for (let decade = Math.floor(Math.log10(min)); decade <= Math.ceil(Math.log10(max)); decade += 1) {
    PRICE_LADDER.forEach((step) => {
      const value = Number((step * 10 ** decade).toPrecision(4));
      if (value >= min * (1 - 1e-9) && value <= max * (1 + 1e-9)) raw.push(value);
    });
  }
  return { min, max, ticks: thinTicks(raw, 7), log: true };
}

/** Keep at most `max` ticks, always including the first and last. */
function thinTicks(values, max) {
  if (values.length <= max) return values;
  const step = Math.ceil(values.length / max);
  const kept = values.filter((_, index) => index % step === 0);
  const last = values.at(-1);
  if (kept.at(-1) !== last) kept.push(last);
  return kept;
}

export function logPosition(value, axis, top, height) {
  const low = Math.log10(Math.max(axis.min, Number.MIN_VALUE));
  const high = Math.log10(axis.max);
  if (!(high > low)) return top + height;
  const clamped = Math.min(axis.max, Math.max(axis.min, value));
  return top + ((high - Math.log10(clamped)) / (high - low)) * height;
}

export function formatAxisPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  // Drop a trailing ".0" so a round tick reads "$50" rather than "$50.0".
  return `$${Number(value.toFixed(decimals))}`;
}

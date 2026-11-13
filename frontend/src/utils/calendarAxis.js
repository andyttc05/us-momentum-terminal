/**
 * Calendar-year axis for the drawdown chart.
 *
 * The chart used to place observations by array index, so a backtest starting
 * on 2 April 2018 stretched the remaining nine months of 2018 across a full
 * label gap while every later year got one too. That made 2018/2019/2020 look
 * cramped next to 2021 onward, because index spacing says nothing about
 * elapsed time.
 *
 * This scale maps each observation to the horizontal position of its real
 * date. Every calendar year owns exactly one segment of the plot, so the 1
 * January ticks are evenly spaced by construction, and a partial first year
 * simply starts the series part way into its segment instead of being
 * stretched to fill it.
 *
 * Within a year, the position is the elapsed fraction of that year, so 2 April
 * lands a quarter of the way into the 2018 segment and 2 January of any later
 * year lands at the very start of its own segment. Leap years are one day
 * longer than the segment is wide; that 0.27% distortion is invisible and is
 * the price of equal year widths.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Horizontal room kept at both ends so the first and last labels stay whole. */
export const CALENDAR_AXIS_INSET = 18;

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Parse a strict `YYYY-MM-DD` string into UTC calendar parts. */
export function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** First and last calendar year covered by the observation dates. */
export function calendarYearSpan(dates) {
  if (!Array.isArray(dates) || dates.length === 0) return null;
  let firstYear = null;
  let lastYear = null;

  for (const value of dates) {
    const parsed = parseIsoDate(value);
    if (!parsed) continue;
    if (firstYear === null || parsed.year < firstYear) firstYear = parsed.year;
    if (lastYear === null || parsed.year > lastYear) lastYear = parsed.year;
  }

  return firstYear === null ? null : { firstYear, lastYear };
}

/**
 * Build the drawdown x-axis.
 *
 * Returns `null` when no usable date is present, so callers can fall back to a
 * plain index mapping instead of drawing an axis with no domain.
 *
 * `ticks` holds one entry per calendar year from the first observation's year
 * through the last one's, each at its 1 January boundary.
 */
export function createCalendarScale(dates, left, plotWidth, inset = CALENDAR_AXIS_INSET) {
  const span = calendarYearSpan(dates);
  if (!span) return null;

  const { firstYear, lastYear } = span;
  const yearCount = lastYear - firstYear + 1;
  const width = Math.max(0, plotWidth);
  const safeInset = Math.min(Math.max(inset, 0), width / 2);
  const innerLeft = left + safeInset;
  const innerWidth = Math.max(1, width - safeInset * 2);
  const segmentWidth = innerWidth / yearCount;

  function xForDate(value) {
    const parsed = parseIsoDate(value);
    if (!parsed) return null;
    const year = Math.min(Math.max(parsed.year, firstYear), lastYear);
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1);
    const at = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
    const elapsed = (at - yearStart) / (yearEnd - yearStart);
    const fraction = Math.min(Math.max(elapsed, 0), 1);
    return innerLeft + (year - firstYear + fraction) * segmentWidth;
  }

  const ticks = Array.from({ length: yearCount }, (_, index) => ({
    year: String(firstYear + index),
    x: innerLeft + index * segmentWidth,
  }));

  return {
    firstYear,
    lastYear,
    yearCount,
    innerLeft,
    innerRight: innerLeft + innerWidth,
    segmentWidth,
    xForDate,
    ticks,
  };
}

/**
 * Show every label while they fit, then every second, third, and so on.
 *
 * Skipping keeps the surviving labels on the same even grid; it never moves
 * one to make room, so a narrow chart cannot misrepresent the time axis.
 */
export function labelStride(segmentWidth, minimumGap) {
  if (!Number.isFinite(segmentWidth) || segmentWidth <= 0) return 1;
  if (!Number.isFinite(minimumGap) || minimumGap <= 0) return 1;
  return Math.max(1, Math.ceil(minimumGap / segmentWidth));
}

/** Calendar ticks that survive the density reduction, first year included. */
export function visibleYearTicks(ticks, segmentWidth, minimumGap) {
  if (!Array.isArray(ticks) || ticks.length === 0) return [];
  const stride = labelStride(segmentWidth, minimumGap);
  if (stride === 1) return ticks;
  return ticks.filter((_, index) => index % stride === 0);
}

/**
 * Width a four-digit year label needs at the chart's label size.
 *
 * The glyphs measure 31px at 12px and 23px at 10px. The added margin is what
 * keeps the row readable rather than merely non-overlapping: at 390px nine
 * labels would sit 2.6px apart and read as one run of digits, so the axis
 * thins to every other year there instead. Desktop and tablet keep all nine.
 */
export function yearLabelGap(compact) {
  return compact ? 30 : 33;
}

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Turn a `YYYY-MM-DD` stamp into a day number (days since the epoch).
 * Parsed as UTC on purpose: the chart only needs differences in whole days, so
 * a local-timezone parse must not be able to shift a tick by one day.
 * Returns null for anything that is not a plain ISO date.
 */
export function dayNumber(stamp) {
  const match = ISO_DATE.exec(typeof stamp === "string" ? stamp.trim() : "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = Date.UTC(year, month - 1, day);
  return Number.isFinite(value) ? Math.round(value / MS_PER_DAY) : null;
}

/**
 * Build the single date -> fraction mapping a chart draws with.
 *
 * `0` is the first sample and `1` is the last, so a window that opens
 * mid-month gives the partial month only the width its real elapsed days earn.
 * Every x coordinate on the chart — series points and month labels alike — has
 * to come from this one function, otherwise the axis stops being a time axis.
 *
 * Returns null when the stamps are missing, malformed or all on one day, so the
 * caller can fall back to its previous behaviour instead of drawing garbage.
 */
export function createDateScale(stamps) {
  if (!Array.isArray(stamps) || stamps.length < 2) return null;
  const days = stamps.map(dayNumber);
  if (days.some((day) => day === null)) return null;
  const first = days[0];
  const span = days[days.length - 1] - first;
  if (!(span > 0)) return null;
  return (stamp) => {
    const day = dayNumber(stamp);
    return day === null ? null : (day - first) / span;
  };
}

/**
 * Place the x-axis labels at the positions their own dates map to.
 *
 * Thinning uses one constant stride — every n-th month — chosen as the smallest
 * stride that leaves every label clear of its neighbour. Dropping labels
 * wherever a collision happens to occur would leave a ragged axis (two adjacent
 * months next to a two-month gap), which is the very thing that reads as a
 * spacing bug. A label is never nudged sideways: if it cannot be drawn where its
 * date belongs, it is dropped.
 */
export function placeTicks(specs, { xFor, width, charWidth, gap = 10 }) {
  const candidates = [];
  for (const spec of specs ?? []) {
    if (!spec || !spec.label) continue;
    const x = xFor(spec);
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    candidates.push({ spec, x });
  }
  if (!candidates.length) return [];

  const halfWidth = (spec) => Math.max(5, (spec.label.length * charWidth) / 2);
  const fitsAt = (stride) => {
    const chosen = candidates.filter((_, index) => index % stride === 0);
    return chosen.every((item, index) => {
      const previous = chosen[index - 1];
      if (!previous) return true;
      return item.x - halfWidth(item.spec) >= previous.x + halfWidth(previous.spec) + gap;
    });
  };

  let stride = 1;
  while (stride < candidates.length && !fitsAt(stride)) stride += 1;

  return candidates
    .filter((_, index) => index % stride === 0)
    .filter(({ spec, x }) => x - halfWidth(spec) >= 0 && x + halfWidth(spec) <= width)
    .map(({ spec, x }) => ({ ...spec, x }));
}

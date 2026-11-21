/**
 * The end-of-series value pill, shared by the Overview performance chart and
 * the backtest equity curve.
 *
 * Both charts used to reserve a fixed pill width (82 in one, 91 for percentages
 * and 112 for dollars in the other), so identical labels got very different
 * amounts of air and a dollar value sat in a pill half again as wide as its own
 * text. A pill is now sized from the text it holds, with one padding for the
 * whole app, so the label always reads as the pill's content.
 *
 * Advances below are measured from the app's label face — Nunito Sans 800 at
 * 12px. Digits, "$", "+" and "−" all take the tabular 0.6em advance, so a value
 * string's width is a sum of exact advances instead of a guess. The 9px compact
 * label is the same face scaled by 0.75.
 */

export const VALUE_PILL = Object.freeze({
  height: 24,
  compactHeight: 20,
  paddingInline: 12,
  compactPaddingInline: 9,
  minWidth: 48,
  compactMinWidth: 40,
  fontSize: 12,
  compactFontSize: 9,
  // The leader gets this much runway before the pill, so the pill never sits on
  // the endpoint dot.
  leaderGap: 12,
  compactLeaderGap: 9,
});

const BASE_FONT_SIZE = VALUE_PILL.fontSize;
// Everything not listed uses the tabular digit advance (digits, "$", "+", "−").
const DEFAULT_ADVANCE = 7.2;

/** Advance widths in px at 12px, measured from Nunito Sans 800. */
const ADVANCES = Object.freeze({
  ",": 3.115,
  ".": 3.115,
  "%": 11.449,
  "-": 5.276,
  " ": 3.334,
  M: 10.51,
  K: 8.25,
  B: 8.339,
  T: 7.587,
  "—": 12,
});

/** Rendered width of one pill label at the given label size. */
export function valueTextWidth(text, fontSize = VALUE_PILL.fontSize) {
  const scale = fontSize / BASE_FONT_SIZE;
  let width = 0;
  for (const character of String(text ?? "")) {
    width += (ADVANCES[character] ?? DEFAULT_ADVANCE) * scale;
  }
  return width;
}

/**
 * One pill width for a chart: wide enough for its widest label plus the shared
 * padding, never narrower than the minimum. All pills in a chart share it, so
 * the three series read as one column instead of three ragged blocks.
 */
export function valuePillWidth(labels, { compact = false } = {}) {
  const fontSize = compact ? VALUE_PILL.compactFontSize : VALUE_PILL.fontSize;
  const padding = compact ? VALUE_PILL.compactPaddingInline : VALUE_PILL.paddingInline;
  const minimum = compact ? VALUE_PILL.compactMinWidth : VALUE_PILL.minWidth;
  const widest = (Array.isArray(labels) ? labels : [])
    .reduce((max, label) => Math.max(max, valueTextWidth(label, fontSize)), 0);
  return Math.max(minimum, Math.ceil(widest) + padding * 2);
}

export function pillHeightFor(compact) {
  return compact ? VALUE_PILL.compactHeight : VALUE_PILL.height;
}

export function leaderGapFor(compact) {
  return compact ? VALUE_PILL.compactLeaderGap : VALUE_PILL.leaderGap;
}

/**
 * Short connector from a series endpoint to its value pill: a straight stub
 * when the pill already sits on the endpoint, a single soft curve otherwise.
 *
 * The path ends exactly on the pill's left edge. The pill is painted after the
 * leader in all three charts, so the join is clean instead of showing a gap.
 */
export function leaderPath(startX, startY, pillX, labelY) {
  const dy = labelY - startY;
  if (Math.abs(dy) < 1) return `M ${startX} ${startY} L ${pillX} ${startY}`;
  const midX = startX + (pillX - startX) * 0.55;
  return `M ${startX} ${startY} C ${midX} ${startY} ${midX} ${labelY} ${pillX} ${labelY}`;
}

/**
 * Build year labels for the drawdown chart without silently dropping a year
 * when the backtest begins late in the first calendar year.
 *
 * The first observation can be near year-end, which puts the first two year
 * boundaries almost on top of each other. Instead of removing the next year
 * label, nudge it right just enough to maintain readable spacing. The plotted
 * series remains on its original observation coordinates; only text labels
 * move. On narrow charts, labels are skipped only when there is not enough
 * room to fit them without overlap or clipping.
 */
export function resolveYearLabelPositions(dates, left, plotWidth, minGap = 48) {
  if (!Array.isArray(dates) || dates.length === 0) return [];

  const candidates = [];
  let currentYear = "";

  dates.forEach((date, index) => {
    const year = typeof date === "string" ? date.slice(0, 4) : "";
    const isYear = year.length === 4 && [...year].every((char) => char >= "0" && char <= "9");
    if (!isYear || year === currentYear) return;
    currentYear = year;
    candidates.push({
      year,
      x: left + index / Math.max(1, dates.length - 1) * plotWidth,
    });
  });

  if (!candidates.length) return [];

  const minX = left + 18;
  const maxX = left + plotWidth - 18;
  if (maxX < minX) return [];

  const clamp = (value) => Math.min(Math.max(value, minX), maxX);
  const placed = [{ ...candidates[0], x: clamp(candidates[0].x) }];

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const previous = placed[placed.length - 1];
    const naturalX = clamp(candidate.x);
    const adjustedX = Math.max(naturalX, previous.x + minGap);
    const remainingLabels = candidates.length - index - 1;
    const latestSafeX = maxX - remainingLabels * minGap;

    // If all remaining labels cannot fit, preserve the current and final
    // labels where possible instead of allowing text to overlap or clip.
    if (adjustedX > latestSafeX) continue;
    placed.push({ ...candidate, x: adjustedX });
  }

  return placed;
}

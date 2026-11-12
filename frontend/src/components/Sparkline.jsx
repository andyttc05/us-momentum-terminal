import { momentumSeriesPoints } from "../utils/momentumSeries.js";

/**
 * The Screener miniature. It draws the canonical 12-1 momentum series with the
 * shared universe domain, so a row's shape is always the same path at the same
 * scale — never a separate calculation and never a per-row rescale.
 */
export function Sparkline({ values = [], label, className = "", stretch = false, domain }) {
  if (!Array.isArray(values) || values.length < 2) {
    return <span className={`sparkline sparkline--unavailable ${className}`.trim()} role="img" aria-label={`${label} price path unavailable`}>—</span>;
  }
  const points = momentumSeriesPoints(values, domain);
  return (
    <svg className={`sparkline ${className}`.trim()} viewBox="0 0 100 26" preserveAspectRatio={stretch ? "none" : undefined} role="img" aria-label={`${label} indexed adjusted price path, starting at 100`}>
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

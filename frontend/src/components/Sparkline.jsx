import { momentumSparklinePoints } from "../utils/sparkline.js";

export function Sparkline({ values = [], label, className = "", stretch = false, domain }) {
  if (!Array.isArray(values) || values.length < 2) {
    return <span className={`sparkline sparkline--unavailable ${className}`.trim()} role="img" aria-label={`${label} price path unavailable`}>—</span>;
  }
  const points = momentumSparklinePoints(values, domain);
  return (
    <svg className={`sparkline ${className}`.trim()} viewBox="0 0 100 26" preserveAspectRatio={stretch ? "none" : undefined} role="img" aria-label={`${label} adjusted price path`}>
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

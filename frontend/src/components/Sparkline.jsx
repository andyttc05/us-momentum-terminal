export function Sparkline({ values, label, className = "", stretch = false }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${23 - ((value - min) / span) * 19}`).join(" ");

  return (
    <svg className={`sparkline ${className}`.trim()} viewBox="0 0 100 26" preserveAspectRatio={stretch ? "none" : undefined} role="img" aria-label={`${label} price trend`}>
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

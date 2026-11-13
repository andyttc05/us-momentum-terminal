/**
 * Shared structure-preserving placeholders. These render inside the existing
 * card, chart, or table shell so data arrival never changes the page layout.
 */
export function Skeleton({
  width = "100%",
  height = "1em",
  radius = "var(--radius-pill)",
  className = "",
  style,
}) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function DataState({
  state = "empty",
  title,
  detail,
  className = "",
}) {
  const loading = state === "loading";
  const fallbackTitle = state === "error" ? "Data unavailable" : "No data available";

  return (
    <div
      className={`data-state data-state--${state} ${className}`.trim()}
      data-state={state}
      role="status"
      aria-live="polite"
      aria-busy={loading || undefined}
    >
      {loading ? (
        <>
          <span className="visually-hidden">{title ?? "Loading verified data…"}</span>
          <span className="data-state__skeleton" aria-hidden="true">
            <Skeleton width="38%" height="11px" />
            <Skeleton width="72%" height="22px" />
            <Skeleton width="54%" height="11px" />
          </span>
        </>
      ) : (
        <>
          <strong>{title ?? fallbackTitle}</strong>
          {detail && <span>{detail}</span>}
        </>
      )}
    </div>
  );
}

export function ChartState({
  state = "loading",
  title,
  detail,
  className = "",
}) {
  const loading = state === "loading";
  return (
    <div
      className={`chart-state chart-state--${state} ${className}`.trim()}
      data-state={state}
      role="status"
      aria-live="polite"
      aria-busy={loading || undefined}
    >
      {loading ? (
        <>
          <span className="visually-hidden">{title ?? "Loading chart data…"}</span>
          <svg className="chart-state__skeleton" viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 178 C70 174 90 143 150 151 S232 109 300 124 S380 71 446 86 S526 42 600 55" />
          </svg>
        </>
      ) : (
        <div className="chart-state__copy">
          <strong>{title ?? (state === "error" ? "Chart unavailable" : "No chart data")}</strong>
          {detail && <span>{detail}</span>}
        </div>
      )}
    </div>
  );
}

const CELL_WIDTHS = ["32%", "76%", "68%", "56%", "62%", "48%", "58%", "70%", "64%"];

export function TableSkeletonRows({ columns, rows = 10 }) {
  return Array.from({ length: rows }, (_, rowIndex) => (
    <tr className="table-skeleton-row" key={rowIndex} aria-hidden="true">
      {Array.from({ length: columns }, (_, columnIndex) => (
        <td key={columnIndex}>
          <Skeleton width={CELL_WIDTHS[columnIndex % CELL_WIDTHS.length]} height="12px" />
        </td>
      ))}
    </tr>
  ));
}

export function TableStateRow({ columns, state, title, detail }) {
  return (
    <tr className="table-state-row">
      <td colSpan={columns}>
        <DataState state={state} title={title} detail={detail} />
      </td>
    </tr>
  );
}

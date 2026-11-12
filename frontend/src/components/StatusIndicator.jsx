const statusClass = {
  ready: "status-indicator--ready",
  stale: "status-indicator--stale",
  loading: "status-indicator--loading",
  error: "status-indicator--error",
  neutral: "status-indicator--neutral",
};

export function StatusIndicator({ status = "neutral", children }) {
  return (
    <span className={`status-indicator ${statusClass[status] ?? statusClass.neutral}`}>
      <span className="status-indicator__dot" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

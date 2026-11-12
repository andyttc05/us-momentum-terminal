/**
 * Resolve one user-facing data notice. Technical errors must never be rendered
 * directly; the backend keeps those details in logs and health diagnostics.
 */
export function getDataNoticeState({
  error,
  status,
  meta,
  refreshing,
  lastRefreshCompletedAt,
  now = Date.now(),
}) {
  if (error || status === "error" || meta?.cache_state === "error") {
    return { id: "error", message: "Service unavailable" };
  }
  if (status === "loading" || refreshing || meta?.refresh_in_progress || meta?.cache_state === "warming") {
    return { id: "loading", message: "Updating data…" };
  }
  if (meta?.cache_state === "partial") {
    return { id: "partial", message: "Some data unavailable" };
  }
  if (meta?.cache_state === "cached") {
    return { id: "cached", message: "Cached data" };
  }
  if (lastRefreshCompletedAt && now - new Date(lastRefreshCompletedAt).getTime() < 4200) {
    return { id: "updated", message: "Data updated" };
  }
  return null;
}

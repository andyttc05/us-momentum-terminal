/**
 * Resolve one user-facing data notice. Technical errors must never be rendered
 * directly; the backend keeps those details in logs and health diagnostics.
 */
export function getDataNoticeState({
  error,
  status,
  meta,
  refreshing,
  notice,
}) {
  if (isDataUpdating({ status, meta, refreshing })) return null;
  if (error || status === "error" || meta?.cache_state === "error") {
    return { id: "error", message: "Update failed" };
  }
  if (!notice?.id) return null;
  const messages = {
    updated: "Data updated",
    cached: "Using cached data",
    partial: "Partial update",
    error: "Update failed",
  };
  if (!messages[notice.id]) return null;
  return { ...notice, message: messages[notice.id] };
}

export function isDataUpdating({ status, meta, refreshing }) {
  return Boolean(
    status === "loading"
    || refreshing
    || meta?.refresh_in_progress
    || meta?.cache_state === "warming",
  );
}

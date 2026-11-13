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

/** A successful response must carry at least one page-relevant section. */
export function hasMarketData(data) {
  return Boolean(
    data
    && (
      data.stocks?.length
      || data.overview
      || data.portfolio
      || data.backtest
    )
  );
}

/**
 * The update pill distinguishes a failed request with valid prior data from a
 * request that has no data to fall back to. The global status toast reports the
 * failure itself; the pill keeps describing the timeliness of visible data.
 */
export function getFetchDisplayState({
  staticMode,
  data,
  status,
  meta,
  error,
  refreshing,
}) {
  const hasData = hasMarketData(data);
  const updating = isDataUpdating({ status, meta, refreshing });
  if (staticMode && hasData) return meta?.client_cache ? "cached" : "published";
  if (staticMode) return updating ? "loading" : "failed";
  if (updating) return hasData ? "updating" : "loading";
  if (error || status === "error" || meta?.cache_state === "error") {
    return hasData ? "cached" : "failed";
  }
  if (meta?.cache_state === "cached") return "cached";
  if (meta?.cache_state === "partial") return "partial";
  return hasData ? "updated" : "empty";
}

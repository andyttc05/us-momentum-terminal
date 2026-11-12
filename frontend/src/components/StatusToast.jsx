import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useMarket } from "../api/MarketProvider.jsx";
import { getDataNoticeState } from "../utils/dataStatus.js";
import { Toast } from "./Toast.jsx";

const AUTO_DISMISS_MS = 4200;

/**
 * The single bottom-right data-state notice. Initial loads, partial results,
 * cached fallbacks and manual refreshes all use the same compact pill.
 */
export function StatusToast() {
  const {
    error,
    data,
    meta,
    status,
    refreshing,
    lastRefreshCompletedAt,
    refresh,
    reload,
  } = useMarket();
  const [dismissedKey, setDismissedKey] = useState("");
  const [retrying, setRetrying] = useState(false);

  const state = useMemo(() => {
    const resolved = getDataNoticeState({
      error,
      status,
      meta,
      refreshing,
      lastRefreshCompletedAt,
      hasData: Boolean(data?.stocks?.length),
    });
    if (!resolved) return null;
    return { ...resolved, retry: resolved.id === "error" };
  }, [data?.stocks?.length, error, lastRefreshCompletedAt, meta, refreshing, status]);

  const key = state
    ? `${state.id}:${meta?.as_of ?? ""}:${data?.universe?.scanned ?? 0}:${lastRefreshCompletedAt?.getTime?.() ?? 0}`
    : "";

  useEffect(() => {
    if (!state || state.id === "error" || dismissedKey === key) return undefined;
    const timer = window.setTimeout(() => setDismissedKey(key), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dismissedKey, key, state]);

  if (!state || dismissedKey === key) return null;

  async function retry() {
    setRetrying(true);
    if (data?.stocks?.length) await refresh();
    else await reload();
    setRetrying(false);
    setDismissedKey("");
  }

  return (
    <Toast
      kind={state.id}
      message={state.message}
      className="status-toast"
      durationMs={state.id === "error" ? undefined : AUTO_DISMISS_MS}
      action={state.retry ? (
        <button type="button" className="notification-toast__action" onClick={retry} disabled={retrying}>
          <ArrowClockwise size={13} weight="bold" aria-hidden="true" />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      ) : null}
      onDismiss={state.id === "error" ? () => setDismissedKey(key) : undefined}
      dismissLabel="Dismiss status notification"
    />
  );
}

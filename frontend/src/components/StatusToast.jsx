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
    dataNotice,
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
      notice: dataNotice,
    });
    if (!resolved) return null;
    return { ...resolved, retry: resolved.id === "error" };
  }, [dataNotice, error, meta, refreshing, status]);

  const key = state?.key ?? state?.id ?? "";

  useEffect(() => {
    if (!state || state.id === "error" || dismissedKey === key) return undefined;
    const timer = window.setTimeout(() => setDismissedKey(key), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dismissedKey, key, state]);

  if (!state || dismissedKey === key) return null;

  async function retry() {
    setRetrying(true);
    setDismissedKey("");
    if (data?.stocks?.length) await refresh();
    else await reload({ isRefresh: true, trackCompletion: true });
    setRetrying(false);
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

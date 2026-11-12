import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  CloudSlash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useMarket } from "../api/MarketProvider.jsx";
import { getDataNoticeState } from "../utils/dataStatus.js";

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
    const visual = {
      error: { Icon: CloudSlash, retry: true },
      loading: { Icon: CircleNotch, retry: false },
      partial: { Icon: WarningCircle, retry: false },
      cached: { Icon: WarningCircle, retry: false },
      updated: { Icon: CheckCircle, retry: false },
    }[resolved.id];
    return { ...resolved, ...visual };
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

  const { Icon } = state;
  return (
    <div
      className={`status-toast status-toast--${state.id}`}
      role={state.id === "error" ? "alert" : "status"}
      aria-live={state.id === "error" ? "assertive" : "polite"}
    >
      <span className="status-toast__icon" aria-hidden="true">
        <Icon size={15} weight={state.id === "loading" ? "bold" : "fill"} />
      </span>
      <span className="status-toast__message">{state.message}</span>
      {state.retry && (
        <button type="button" className="status-toast__action" onClick={retry} disabled={retrying}>
          <ArrowClockwise size={12} weight="bold" aria-hidden="true" />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
      {state.id === "error" && (
        <button
          type="button"
          className="status-toast__close"
          aria-label="Dismiss"
          onClick={() => setDismissedKey(key)}
        >
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

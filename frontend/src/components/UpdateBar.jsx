import { useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { AppButton } from "./AppButton.jsx";
import { DataStatusDialog } from "./DataStatusDialog.jsx";
import { useMarket } from "../api/MarketProvider.jsx";
import { getFetchDisplayState, hasMarketData } from "../utils/dataStatus.js";

const FETCH_LABEL = {
  loading: "Updating…",
  updating: "Updating…",
  updated: "Updated",
  failed: "Update failed",
  empty: "No data",
  published: "Published",
  partial: "Partial data",
  cached: "Cached data",
};

const TIMELINESS_LABEL = {
  realtime: "Real-time",
  delayed: "Delayed",
  "end-of-day": "End of day",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Always render "Nov 11, 2026", whatever form the page passes in. */
function formatDateLabel(iso) {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!match) return String(iso);
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

/**
 * The single update bar for every main page.
 *
 * One component renders the whole pill — dot, label, date, divider and refresh
 * button — so Overview, Screener, Portfolio and Backtesting cannot drift apart.
 * The fetch state is read from the market provider here rather than passed in,
 * which keeps the label and the dot in sync with the actual request.
 *
 * The pill dates the snapshot's collection, not the market data: a page cannot
 * make it say something that reads like "published on Friday". Formatting
 * happens here so every page shows the same date style in the same place.
 */
export function UpdateBar({ ariaLabel = "Check for updates", onRefresh, busy = false, className = "" }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const { data, meta, status, error, refreshing, refresh, staticMode, dataOrigin, refreshAttempt } = useMarket();

  const hasData = hasMarketData(data);
  const fetching = refreshing || busy;
  const cacheState = meta?.cache_state;
  const publishedOnly = staticMode;
  let fetchState = getFetchDisplayState({
    staticMode: publishedOnly,
    data,
    status,
    meta,
    error,
    refreshing: fetching,
  });
  if (refreshAttempt?.state === "updating" || refreshAttempt?.state === "queued") fetchState = "updating";
  if (refreshAttempt?.state === "updated") fetchState = "updated";
  if (refreshAttempt?.state === "failed") fetchState = "failed";

  /* The pill dates the *collection*, on every page. It used to carry the market
     data's as-of date (or, on Backtesting, the window's end), which stands still
     over a weekend: the site was showing Friday's close collected minutes ago
     and read as days old. The as-of date still travels in the tooltip and in the
     data dialog, where it is labelled. */
  const shownDate = hasData ? meta?.generated_at || "" : "";
  const asOfLabel = meta?.as_of && meta.as_of !== shownDate ? formatDateLabel(meta.as_of) : "";

  const timeliness = meta ? TIMELINESS_LABEL[meta.timeliness] ?? meta.timeliness : null;
  const origin = dataOrigin === "browser-cache"
    ? "Browser cache"
    : staticMode
      ? "Published GitHub Pages snapshot"
      : "Local development service";
  const tooltip = meta ? [
    origin,
    meta.data_provider,
    timeliness,
    hasData && (error || status === "error") ? "Showing latest valid data; update failed" : null,
    cacheState === "cached" ? (fetchState === "updating" ? "Showing cached data while refreshing" : "Showing cached data") : null,
    meta.generated_at ? `Collected ${formatDateLabel(meta.generated_at)}` : null,
    asOfLabel ? `Market data through ${asOfLabel}` : null,
  ].filter(Boolean).join(" · ") : "Market data source";
  return (
    <>
      <div className={`update-bar update-bar--${fetchState} ${className}`.trim()} title={tooltip}>
        <button
          type="button"
          className="update-bar__summary"
          aria-haspopup="dialog"
          aria-expanded={statusOpen}
          aria-label="Open data and cache status"
          onClick={() => setStatusOpen(true)}
        >
          <span className="update-bar__dot" aria-hidden="true" />
          <span className="update-bar__label">{FETCH_LABEL[fetchState]}</span>
          <time className="update-bar__date" dateTime={shownDate}>{formatDateLabel(shownDate)}</time>
        </button>
        <span className="update-bar__divider" aria-hidden="true" />
        <AppButton
          variant="quiet"
          icon={ArrowClockwise}
          iconOnly
          ariaLabel={ariaLabel}
          title={ariaLabel}
          className="refresh-button"
          onClick={onRefresh ?? (() => refresh())}
          disabled={fetching}
        />
      </div>
      <DataStatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} />
    </>
  );
}

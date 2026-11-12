import { ArrowClockwise } from "@phosphor-icons/react";
import { AppButton } from "./AppButton.jsx";
import { useMarket } from "../api/MarketProvider.jsx";
import { isDataUpdating } from "../utils/dataStatus.js";

const FETCH_LABEL = {
  loading: "Updating…",
  updating: "Updating…",
  updated: "Updated",
  failed: "Update failed",
  empty: "No data",
  static: "Static preview",
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
 * `dateTime` is the ISO date the page reports (a snapshot as-of date, or the
 * backtest window end). Formatting happens here so every page shows the same
 * date style in the same place.
 */
export function UpdateBar({ dateTime, ariaLabel = "Refresh data", onRefresh, busy = false }) {
  const { data, meta, status, error, refreshing, refresh, staticMode } = useMarket();

  const hasData = Boolean(data);
  const fetching = refreshing || busy;
  const cacheState = meta?.cache_state;
  const updating = isDataUpdating({ status, meta, refreshing: fetching });
  const fetchState = staticMode
    ? "static"
    : updating ? (hasData ? "updating" : "loading")
    : error || status === "error" || cacheState === "error" ? "failed"
    : cacheState === "cached" ? "cached"
    : cacheState === "partial" ? "partial"
    : !hasData ? "empty" : "updated";

  const timeliness = meta ? TIMELINESS_LABEL[meta.timeliness] ?? meta.timeliness : null;
  const tooltip = staticMode
    ? "Static preview: live market data needs the local Python backend"
    : meta ? [
      meta.data_provider,
      timeliness,
      cacheState === "cached" ? (updating ? "Showing cached data while refreshing" : "Showing cached data") : null,
    ].filter(Boolean).join(" · ") : "Market data source";
  const shownDate = hasData ? dateTime ?? "" : "";

  return (
    <div className={`update-bar update-bar--${fetchState}`} title={tooltip}>
      <span className="update-bar__dot" aria-hidden="true" />
      <span className="update-bar__label">{FETCH_LABEL[fetchState]}</span>
      <time className="update-bar__date" dateTime={shownDate}>{formatDateLabel(shownDate)}</time>
      <span className="update-bar__divider" aria-hidden="true" />
      <AppButton
        variant="quiet"
        icon={ArrowClockwise}
        iconOnly
        ariaLabel={ariaLabel}
        className="refresh-button"
        onClick={onRefresh ?? (() => refresh())}
        disabled={fetching || staticMode}
      />
    </div>
  );
}

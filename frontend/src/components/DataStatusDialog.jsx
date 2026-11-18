import { useEffect, useRef } from "react";
import { ArrowClockwise, Database, X } from "@phosphor-icons/react";
import { useMarket } from "../api/MarketProvider.jsx";
import { AppButton } from "./AppButton.jsx";
import { getRefreshChallenge } from "../api/refreshChallenge.js";
import { isPublicationStale } from "../api/publicationStatus.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(value) {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

function formatAge(value) {
  if (!value) return "unknown";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function DataStatusDialog({ open, onClose }) {
  const dialogRef = useRef(null);
  const {
    data,
    meta,
    status,
    error,
    refreshing,
    checkingForUpdates,
    dataMode,
    dataOrigin,
    refresh,
    refreshMarketData,
    refreshBrokerEnabled,
    refreshAttempt,
  } = useMarket();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const modeCopy = dataOrigin === "browser-cache"
    ? "Browser cache"
    : dataMode === "static" ? "Published snapshot" : "Local data service";
  const stateCopy = error && data
    ? "Showing the last valid cached copy"
    : status === "error" || (!data && !refreshing)
      ? "No valid snapshot is available"
      : checkingForUpdates
        ? "Checking for an update"
        : refreshing
          ? "Updating market data"
        : "Current published data";
  const staticSnapshot = meta?.staticSnapshot;
  const stale = isPublicationStale(meta?.generated_at);
  const marketRefreshActive = ["updating", "queued"].includes(refreshAttempt?.state);

  // One action, not two. The broker refresh already revalidates the published
  // manifest on its way through, so a separate "check" button only offered the
  // same outcome with a longer wait.
  async function requestRefresh() {
    if (!refreshBrokerEnabled) {
      await refresh();
      return;
    }
    try {
      const token = await getRefreshChallenge();
      await refreshMarketData({ challengeToken: token });
    } catch (verificationError) {
      // Verification happens before any broker request. Record the failure
      // locally and preserve the visible last-good publication.
      await refreshMarketData({ requestError: verificationError });
    }
  }

  const actionLabel = marketRefreshActive
    ? "Updating…"
    : checkingForUpdates || (refreshing && !marketRefreshActive)
      ? "Checking…"
      : refreshBrokerEnabled ? "Refresh market data" : "Check for updates";

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      aria-labelledby="data-status-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="app-dialog__panel">
        <button type="button" className="app-dialog__close" aria-label="Close data status" onClick={onClose}>
          <X size={18} weight="bold" aria-hidden="true" />
        </button>
        <header className="app-dialog__header">
          <span className="app-dialog__icon"><Database size={22} weight="regular" aria-hidden="true" /></span>
          <div className="app-dialog__heading">
            <p className="app-dialog__eyebrow">Data &amp; cache</p>
            <h2 id="data-status-title" className="app-dialog__title">{modeCopy}</h2>
            <p className="app-dialog__description">{stateCopy}</p>
          </div>
        </header>

        {/* Six facts in three paired rows instead of a twelve-row list: the
            version string, the raw request id and the browser-cache timestamp
            were diagnostics nobody opens this dialog to read. */}
        <dl className="app-dialog__rows app-dialog__rows--compact">
          <div><dt>Market data</dt><dd>{formatDate(meta?.as_of)}</dd></div>
          <div><dt>Updated</dt><dd>{formatAge(meta?.generated_at)}{stale ? " · stale" : ""}</dd></div>
          <div><dt>Provider</dt><dd>{meta?.connection_status === "connected" ? `${meta?.data_provider ?? "Provider"} · connected` : (meta?.data_provider ?? "Unavailable")}</dd></div>
          <div><dt>Stocks</dt><dd>{data?.stocks?.length ?? "—"}</dd></div>
          <div><dt>Backtests</dt><dd>{staticSnapshot?.backtestCount ?? "—"}</dd></div>
          <div><dt>Last refresh</dt><dd>{refreshAttempt?.result ?? "No request yet"}</dd></div>
        </dl>

        <footer className="data-status-dialog__footer">
          {/* The "Last refresh" row already reports a failed request verbatim;
              repeating it here only added a line of duplication. */}
          {error?.message && error.message !== refreshAttempt?.result && <span>{error.message}</span>}
          <AppButton
            variant="primary"
            icon={ArrowClockwise}
            disabled={refreshing}
            onClick={requestRefresh}
            title={refreshBrokerEnabled ? "Request a secure publish refresh" : "Revalidate the published snapshot"}
          >
            {actionLabel}
          </AppButton>
        </footer>
      </section>
    </dialog>
  );
}

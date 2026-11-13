import { useEffect, useRef } from "react";
import { ArrowClockwise, Database, X } from "@phosphor-icons/react";
import { useMarket } from "../api/MarketProvider.jsx";
import { AppButton } from "./AppButton.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(value) {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

function formatTimestamp(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
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
    dataMode,
    dataOrigin,
    browserCachedAt,
    refresh,
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
    : dataMode === "static"
      ? "Published snapshot"
      : "Live service";
  const stateCopy = error && data
    ? "Showing the last valid cached copy"
    : status === "error" || (!data && !refreshing)
      ? "No valid snapshot is available"
      : refreshing
        ? "Checking for an update"
        : "Current published data";
  const staticSnapshot = meta?.staticSnapshot;

  return (
    <dialog
      ref={dialogRef}
      className="data-status-dialog"
      aria-labelledby="data-status-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="data-status-dialog__panel">
        <button type="button" className="data-status-dialog__close" aria-label="Close data status" onClick={onClose}>
          <X size={18} weight="bold" aria-hidden="true" />
        </button>
        <header className="data-status-dialog__header">
          <span className="data-status-dialog__icon"><Database size={22} weight="regular" aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">Data &amp; cache</p>
            <h2 id="data-status-title">{modeCopy}</h2>
            <p>{stateCopy}</p>
          </div>
        </header>

        <dl className="data-status-dialog__facts">
          <div><dt>Market data through</dt><dd>{formatDate(meta?.as_of)}</dd></div>
          <div><dt>Last successful collection</dt><dd>{formatTimestamp(meta?.generated_at)}</dd></div>
          <div><dt>Published</dt><dd>{formatAge(meta?.generated_at)}</dd></div>
          <div><dt>Provider</dt><dd>{meta?.data_provider ?? "Unavailable"}</dd></div>
          <div><dt>Eligible stocks</dt><dd>{data?.stocks?.length ?? "—"}</dd></div>
          <div><dt>Browser cache</dt><dd>{browserCachedAt ? formatTimestamp(browserCachedAt) : "Not stored"}</dd></div>
          {staticSnapshot && (
            <>
              <div><dt>Stock detail files</dt><dd>{staticSnapshot.detailCount ?? "—"}</dd></div>
              <div><dt>Backtest schedules</dt><dd>{staticSnapshot.backtestCount ?? "—"}</dd></div>
              <div><dt>Snapshot version</dt><dd>{staticSnapshot.publicationVersion ?? "—"}</dd></div>
            </>
          )}
        </dl>

        <p className="data-status-dialog__note">
          {dataMode === "static"
            ? "The deployed site renders the latest validated snapshot published by GitHub Actions. It does not wait for a Python service."
            : "The local site reads the FastAPI service and keeps the last valid browser copy if a refresh fails."}
        </p>

        <footer className="data-status-dialog__footer">
          <span>{error?.message ?? "Cached data remains visible when a refresh fails."}</span>
          <AppButton variant="secondary" icon={ArrowClockwise} disabled={refreshing} onClick={refresh}>
            {refreshing ? "Checking…" : "Check for updates"}
          </AppButton>
        </footer>
      </section>
    </dialog>
  );
}

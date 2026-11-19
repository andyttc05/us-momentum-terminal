/**
 * Notification model for the Backtesting page's run feedback.
 *
 * The page used to rely on `showNotification()`'s 3200 ms default, so passing
 * `undefined` for "keep this on screen" actually armed a timeout and the
 * progress card vanished before the next poll (which was 4 s apart). These
 * builders make persistence explicit and testable: a persistent notification
 * carries `durationMs: null` and therefore no timer at all.
 */

export const RUN_NOTIFICATION_ID = "backtest-running";
export const COMPLETED_NOTIFICATION_ID = "backtest-complete";

/** A run is in flight: no timer, no close button, elapsed time shown. */
export function buildRunNotification(message) {
  return {
    id: RUN_NOTIFICATION_ID,
    message,
    kind: "loading",
    durationMs: null,
    dismissible: false,
    showElapsed: true,
    retry: false,
  };
}

/** The run finished: a normal, auto-dismissing confirmation. */
export function buildCompletedNotification(message = "Backtest complete", durationMs = 3200) {
  return {
    id: COMPLETED_NOTIFICATION_ID,
    message,
    kind: "updated",
    durationMs,
    dismissible: false,
    showElapsed: false,
    retry: false,
  };
}

/** The run failed: stays until dismissed or retried. */
export function buildFailureNotification(message, { id = "backtest-request-error", retry = "backtest" } = {}) {
  return {
    id,
    message,
    kind: "error",
    durationMs: null,
    dismissible: true,
    showElapsed: false,
    retry,
  };
}

/**
 * Replace the run card's message in place.
 *
 * Returns the same object when nothing changed, so React keeps the existing DOM
 * node (and its entering animation) instead of restarting it on every poll. A
 * notification that is no longer the active run card is left untouched.
 */
export function patchRunMessage(current, message) {
  if (!current || current.id !== RUN_NOTIFICATION_ID) return current;
  if (current.message === message) return current;
  return { ...current, message };
}

/** Milliseconds until auto-dismissal, or `null` when the card must persist. */
export function dismissalDelay(notification) {
  if (!notification) return null;
  return Number.isFinite(notification.durationMs) ? notification.durationMs : null;
}

/** The text a card shows, including elapsed time only while a run is active. */
export function notificationText(notification, { elapsedMs, running }) {
  if (!notification) return "";
  if (!notification.showElapsed || !running) return notification.message;
  return `${notification.message} · ${formatElapsed(elapsedMs)}`;
}

export function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

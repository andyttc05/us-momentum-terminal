import {
  CheckCircle,
  CircleNotch,
  CloudSlash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const icons = {
  loading: CircleNotch,
  updating: CircleNotch,
  updated: CheckCircle,
  partial: WarningCircle,
  cached: WarningCircle,
  error: CloudSlash,
};

/** Shared dark notification card used by data-state and page-level events. */
export function Toast({
  kind = "updated",
  message,
  action,
  onDismiss,
  dismissLabel = "Dismiss notification",
  className = "",
  durationMs,
}) {
  const Icon = icons[kind] ?? CheckCircle;
  const autoDismiss = Number.isFinite(durationMs);
  return (
    <div
      className={`notification-toast notification-toast--${kind} ${className}`.trim()}
      data-toast-kind={kind}
      data-auto-dismiss={autoDismiss ? "true" : undefined}
      style={autoDismiss ? { "--toast-duration": `${durationMs}ms` } : undefined}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      <span className="notification-toast__icon" aria-hidden="true">
        <Icon size={17} weight={kind === "loading" || kind === "updating" ? "bold" : "fill"} />
      </span>
      <span className="notification-toast__message">{message}</span>
      {action}
      {onDismiss && (
        <button
          type="button"
          className="notification-toast__close"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

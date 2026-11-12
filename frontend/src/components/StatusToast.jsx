import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, WarningCircle, X } from "@phosphor-icons/react";
import { useMarket } from "../api/MarketProvider.jsx";

const AUTO_DISMISS_MS = 9000;

/**
 * Compact, transient error notice. The full-width banner is gone: failures are
 * reduced to one short line in the bottom-right corner plus a retry action.
 * Dismissing it leaves the status in the update bar, so the failed state is
 * never hidden - only the detail message is.
 */
export function StatusToast() {
  const { error, data, refresh, reload } = useMarket();
  const [visible, setVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!error) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer.current);
  }, [error]);

  if (!visible || !error) return null;

  async function retry() {
    setRetrying(true);
    if (data) await refresh();
    else await reload();
    setRetrying(false);
    setVisible(false);
  }

  return (
    <div className="status-toast" role="status" aria-live="polite">
      <WarningCircle size={15} weight="fill" aria-hidden="true" />
      <span className="status-toast__message">{error.message}</span>
      <button type="button" className="status-toast__action" onClick={retry} disabled={retrying}>
        <ArrowClockwise size={12} weight="bold" aria-hidden="true" />
        {retrying ? "Retrying…" : "Retry"}
      </button>
      <button type="button" className="status-toast__close" aria-label="Dismiss" onClick={() => setVisible(false)}>
        <X size={12} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

import { Info } from "@phosphor-icons/react";
import { useMarket } from "../api/MarketProvider.jsx";

/**
 * A single, calm notice shown only in an explicitly configured static-only
 * build. It explains why market data is unavailable and is intentionally small
 * and persistent rather than a flashing error.
 */
export function StaticNotice() {
  const { staticMode } = useMarket();
  if (!staticMode) return null;

  return (
    <div className="static-notice" role="note" aria-live="polite">
      <Info size={15} weight="fill" aria-hidden="true" />
      <span>Static preview — this build is not connected to a market-data service.</span>
    </div>
  );
}

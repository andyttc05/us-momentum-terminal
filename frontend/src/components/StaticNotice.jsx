import { Info } from "@phosphor-icons/react";
import { useMarket } from "../api/MarketProvider.jsx";

/**
 * A single, calm notice shown only in the static GitHub Pages build, where the
 * Python backend is unavailable. It explains why no market data is shown and is
 * intentionally small and persistent (not a flashing error).
 */
export function StaticNotice() {
  const { staticMode } = useMarket();
  if (!staticMode) return null;

  return (
    <div className="static-notice" role="note" aria-live="polite">
      <Info size={15} weight="fill" aria-hidden="true" />
      <span>Static preview — live market data requires the local Python backend.</span>
    </div>
  );
}

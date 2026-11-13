import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ACTIVE_UNIVERSE_STORAGE_KEY,
  normalizeUniverse,
  readActiveUniverse,
  readUniverseSelection,
  UNIVERSE_STORAGE_KEY,
  writeActiveUniverse,
  writeUniverseSelection,
} from "../utils/universeState.js";

const UniverseContext = createContext(null);

/**
 * Two related but distinct pieces of state live here:
 *
 * - `universe` / `selectUniverse` — the universe configured for the *next*
 *   backtest run. Editing it never relabels results that already exist.
 * - `activeUniverse` / `activateUniverse` — the dataset Overview, Screener and
 *   Portfolio read. A successful backtest activates its own universe, and an
 *   explicit dataset switch keeps the selection in step so the whole app moves
 *   together.
 */
export function UniverseProvider({ children }) {
  const [universe, setUniverse] = useState(readUniverseSelection);
  const [activeUniverse, setActiveUniverse] = useState(
    () => readActiveUniverse(readUniverseSelection()),
  );

  const selectUniverse = useCallback((value) => {
    const next = normalizeUniverse(value);
    setUniverse(next);
    writeUniverseSelection(next);
  }, []);

  const activateUniverse = useCallback((value) => {
    const next = normalizeUniverse(value);
    setActiveUniverse(next);
    writeActiveUniverse(next);
    // Choosing a dataset is also a statement about the universe to work with,
    // so the next backtest defaults to it instead of the previous one.
    setUniverse(next);
    writeUniverseSelection(next);
  }, []);

  useEffect(() => {
    function syncAcrossTabs(event) {
      if (event.key === UNIVERSE_STORAGE_KEY) {
        setUniverse(normalizeUniverse(event.newValue));
      }
      if (event.key === ACTIVE_UNIVERSE_STORAGE_KEY) {
        setActiveUniverse(normalizeUniverse(event.newValue));
      }
    }
    globalThis.addEventListener?.("storage", syncAcrossTabs);
    return () => globalThis.removeEventListener?.("storage", syncAcrossTabs);
  }, []);

  // Persist the dataset in use on the very first visit. Without this, a later
  // reload would fall back to the *selected* universe and silently promote a
  // pending Backtesting choice to the dataset every page reads.
  useEffect(() => {
    writeActiveUniverse(activeUniverse);
  }, [activeUniverse]);

  const value = useMemo(
    () => ({ universe, selectUniverse, activeUniverse, activateUniverse }),
    [activateUniverse, activeUniverse, selectUniverse, universe],
  );
  return <UniverseContext.Provider value={value}>{children}</UniverseContext.Provider>;
}

export function useUniverse() {
  const context = useContext(UniverseContext);
  if (!context) throw new Error("useUniverse must be used inside UniverseProvider");
  return context;
}

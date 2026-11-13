import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  normalizeUniverse,
  readUniverseSelection,
  UNIVERSE_STORAGE_KEY,
  writeUniverseSelection,
} from "../utils/universeState.js";

const UniverseContext = createContext(null);

export function UniverseProvider({ children }) {
  const [universe, setUniverse] = useState(readUniverseSelection);

  const selectUniverse = useCallback((value) => {
    const next = normalizeUniverse(value);
    setUniverse(next);
    writeUniverseSelection(next);
  }, []);

  useEffect(() => {
    function syncAcrossTabs(event) {
      if (event.key === UNIVERSE_STORAGE_KEY) {
        setUniverse(normalizeUniverse(event.newValue));
      }
    }
    globalThis.addEventListener?.("storage", syncAcrossTabs);
    return () => globalThis.removeEventListener?.("storage", syncAcrossTabs);
  }, []);

  const value = useMemo(() => ({ universe, selectUniverse }), [selectUniverse, universe]);
  return <UniverseContext.Provider value={value}>{children}</UniverseContext.Provider>;
}

export function useUniverse() {
  const context = useContext(UniverseContext);
  if (!context) throw new Error("useUniverse must be used inside UniverseProvider");
  return context;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client.js";

const MarketContext = createContext(null);

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// The GitHub Pages build sets VITE_STATIC_SHOWCASE=true. There is no Python
// backend on Pages, so the app renders its full UI with clean "unavailable"
// states instead of polling an API that can never respond. Local builds and
// `npm run dev` leave this unset and keep the normal backend behaviour.
const STATIC_SHOWCASE = import.meta.env.VITE_STATIC_SHOWCASE === "true";

export function MarketProvider({ children }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(STATIC_SHOWCASE ? "static" : "loading"); // loading | ready | error | static
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    if (STATIC_SHOWCASE) return false;
    if (isRefresh) setRefreshing(true);
    try {
      const payload = await api.snapshot();
      if (!mounted.current) return false;
      setData(payload);
      setStatus("ready");
      setError(null);
      setLastLoadedAt(new Date());
      return true;
    } catch (requestError) {
      if (!mounted.current) return false;
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      // Keep the last good payload and "ready" status when we already have data.
      setStatus((current) => (current === "ready" ? "ready" : "error"));
      return false;
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (STATIC_SHOWCASE) return undefined;
    load();
    const timer = window.setInterval(() => load({ isRefresh: true }), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Ask the service to re-pull from the provider, then reload the payload.
  const refresh = useCallback(async () => {
    if (STATIC_SHOWCASE) return false;
    setRefreshing(true);
    let pulled = true;
    try {
      await api.refresh();
    } catch (requestError) {
      pulled = false;
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
    }
    const loaded = await load({ isRefresh: true });
    return pulled && loaded;
  }, [load]);

  // Switch the primary source; the service rebuilds and we reload the payload.
  const selectProvider = useCallback(async (providerId) => {
    if (STATIC_SHOWCASE) return { ok: false };
    setRefreshing(true);
    try {
      await api.setProvider(providerId);
      await load({ isRefresh: true });
      return { ok: true };
    } catch (requestError) {
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      return { ok: false, message: requestError.message };
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [load]);

  const value = useMemo(
    () => ({
      data,
      meta: data?.meta ?? null,
      status,
      error,
      refreshing,
      lastLoadedAt,
      staticMode: STATIC_SHOWCASE,
      refresh,
      selectProvider,
      reload: load,
    }),
    [data, error, lastLoadedAt, load, refresh, refreshing, selectProvider, status],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) throw new Error("useMarket must be used inside MarketProvider");
  return context;
}

export function useStockDetail(ticker) {
  const [state, setState] = useState({ data: null, status: STATIC_SHOWCASE ? "error" : "idle", error: null });

  useEffect(() => {
    if (STATIC_SHOWCASE) return undefined;
    if (!ticker) return undefined;
    let cancelled = false;
    setState({ data: null, status: "loading", error: null });
    api.stock(ticker)
      .then((payload) => {
        if (!cancelled) setState({ data: payload, status: "ready", error: null });
      })
      .catch((requestError) => {
        if (!cancelled) setState({ data: null, status: "error", error: requestError.message });
      });
    return () => { cancelled = true; };
  }, [ticker]);

  return state;
}

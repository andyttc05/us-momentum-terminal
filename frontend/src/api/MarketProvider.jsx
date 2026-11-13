import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./client.js";

const MarketContext = createContext(null);

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// An optional static-only deployment can set VITE_STATIC_SHOWCASE=true. The
// normal GitHub Pages build connects to the hosted FastAPI service through
// VITE_API_BASE_URL; local builds use the Vite proxy.
const STATIC_SHOWCASE = import.meta.env.VITE_STATIC_SHOWCASE === "true";

export function MarketProvider({ children }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(STATIC_SHOWCASE ? "static" : "loading"); // loading | ready | error | static
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [dataNotice, setDataNotice] = useState(null);
  const mounted = useRef(true);
  const noticePending = useRef(true);
  const lastNoticeSignature = useRef("");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const publishFinalNotice = useCallback((meta, requestError = null) => {
    if (requestError || meta?.connection_status === "error") {
      const signature = "error";
      if (lastNoticeSignature.current === signature) return;
      lastNoticeSignature.current = signature;
      noticePending.current = false;
      setDataNotice({ id: "error", key: `${signature}:${Date.now()}` });
      return;
    }
    if (!noticePending.current) return;
    const cacheState = meta?.cache_state;
    const id = cacheState === "partial" ? "partial" : cacheState === "cached" ? "cached" : "updated";
    const signature = `${id}:${meta?.generated_at ?? ""}:${meta?.as_of ?? ""}`;
    if (lastNoticeSignature.current === signature) return;
    lastNoticeSignature.current = signature;
    noticePending.current = false;
    setDataNotice({ id, key: `${signature}:${Date.now()}` });
  }, []);

  const load = useCallback(async ({ isRefresh = false, trackCompletion = false } = {}) => {
    if (STATIC_SHOWCASE) return false;
    if (isRefresh) setRefreshing(true);
    if (trackCompletion) {
      noticePending.current = true;
      lastNoticeSignature.current = "";
    }
    let backgroundRefresh = false;
    try {
      const payload = await api.snapshot();
      if (!mounted.current) return false;
      const meta = payload?.meta ?? {};
      backgroundRefresh = Boolean(meta.refresh_in_progress || meta.cache_state === "warming");
      if (backgroundRefresh) {
        if (!noticePending.current) lastNoticeSignature.current = "";
        noticePending.current = true;
      }
      setData(payload);
      setStatus(backgroundRefresh && !(payload?.stocks?.length) ? "loading" : "ready");
      if (meta.connection_status === "error") {
        setError({ message: "Service unavailable", code: "service_unavailable" });
        setStatus("error");
      } else {
        setError(null);
      }
      setLastLoadedAt(new Date());
      if (!backgroundRefresh) publishFinalNotice(meta);
      setRefreshing(backgroundRefresh);
      return true;
    } catch (requestError) {
      if (!mounted.current) return false;
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      publishFinalNotice(null, requestError);
      // Keep the last good payload and "ready" status when we already have data.
      setStatus((current) => (current === "ready" ? "ready" : "error"));
      return false;
    } finally {
      if (mounted.current && !backgroundRefresh) setRefreshing(false);
    }
  }, [publishFinalNotice]);

  useEffect(() => {
    if (STATIC_SHOWCASE) return undefined;
    load();
    const timer = window.setInterval(() => load({ isRefresh: true }), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (STATIC_SHOWCASE || (!refreshing && status !== "loading")) return undefined;
    const timer = window.setInterval(() => load(), 4000);
    return () => window.clearInterval(timer);
  }, [load, refreshing, status]);

  // Ask the service to re-pull from the provider, then reload the payload.
  const refresh = useCallback(async () => {
    if (STATIC_SHOWCASE) return false;
    setRefreshing(true);
    noticePending.current = true;
    lastNoticeSignature.current = "";
    try {
      await api.refresh();
    } catch (requestError) {
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      publishFinalNotice(null, requestError);
      setRefreshing(false);
      return false;
    }
    return load();
  }, [load, publishFinalNotice]);

  // Switch the primary source; the service rebuilds and we reload the payload.
  const selectProvider = useCallback(async (providerId) => {
    if (STATIC_SHOWCASE) return { ok: false };
    setRefreshing(true);
    noticePending.current = true;
    lastNoticeSignature.current = "";
    try {
      await api.setProvider(providerId);
      await load({ isRefresh: true });
      return { ok: true };
    } catch (requestError) {
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      publishFinalNotice(null, requestError);
      return { ok: false, message: requestError.message };
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [load, publishFinalNotice]);

  const runBacktest = useCallback(async (config) => {
    try {
      return await api.backtest(config);
    } catch (requestError) {
      const frequency = config.rebalance_frequency || "semiannual";
      const fallback = data?.backtestSchedules?.[config.portfolio]?.[frequency];
      if (fallback?.available) return fallback;
      throw requestError;
    }
  }, [data]);

  const value = useMemo(
    () => ({
      data,
      meta: data?.meta ?? null,
      status,
      error,
      refreshing,
      lastLoadedAt,
      dataNotice,
      staticMode: STATIC_SHOWCASE,
      refresh,
      runBacktest,
      selectProvider,
      reload: load,
    }),
    [data, dataNotice, error, lastLoadedAt, load, refresh, refreshing, runBacktest, selectProvider, status],
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

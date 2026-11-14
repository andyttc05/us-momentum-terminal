import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, DATA_MODE } from "./client.js";
import { hasMarketData } from "../utils/dataStatus.js";
import {
  isRebalanceFrequency,
} from "../utils/rebalanceFrequency.js";
import {
  readCachedPublication,
  readCachedStock,
  writeCachedPublication,
  writeCachedStock,
} from "./dataCache.js";

const MarketContext = createContext(null);
const LIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STATIC_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const STATIC_MODE = DATA_MODE === "static";

function cachedPublicationState() {
  const cached = readCachedPublication();
  if (!cached) return null;
  return {
    ...cached,
    data: {
      ...cached.data,
      meta: {
        ...cached.data.meta,
        client_cache: true,
        cache_state: "cached",
      },
    },
  };
}

export function MarketProvider({ children }) {
  const initialCache = useRef(cachedPublicationState());
  const [data, setData] = useState(initialCache.current?.data ?? null);
  const dataRef = useRef(initialCache.current?.data ?? null);
  const [status, setStatus] = useState(initialCache.current ? "ready" : "loading");
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(Boolean(initialCache.current));
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [dataNotice, setDataNotice] = useState(null);
  const [dataOrigin, setDataOrigin] = useState(initialCache.current ? "browser-cache" : "network");
  const [browserCachedAt, setBrowserCachedAt] = useState(initialCache.current?.savedAt ?? null);
  // A user-selected strategy frequency is app-wide configuration, not a page
  // local draft. Portfolio reads it immediately while the Backtesting selector
  // and completed runs remain the only controls that write it.
  const [strategyRebalanceFrequency, setStrategyRebalanceFrequencyState] = useState(null);
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
    const id = cacheState === "partial"
      ? "partial"
      : cacheState === "cached" || meta?.client_cache
        ? "cached"
        : "updated";
    const signature = `${id}:${meta?.generated_at ?? ""}:${meta?.as_of ?? ""}`;
    if (lastNoticeSignature.current === signature) return;
    lastNoticeSignature.current = signature;
    noticePending.current = false;
    setDataNotice({ id, key: `${signature}:${Date.now()}` });
  }, []);

  const load = useCallback(async ({ isRefresh = false, trackCompletion = false, force = false } = {}) => {
    if (isRefresh) setRefreshing(true);
    if (trackCompletion) {
      noticePending.current = true;
      lastNoticeSignature.current = "";
    }
    let backgroundRefresh = false;
    try {
      const payload = await api.snapshot({ force });
      if (!mounted.current) return false;
      const meta = payload?.meta ?? {};
      backgroundRefresh = Boolean(meta.refresh_in_progress || meta.cache_state === "warming");
      if (backgroundRefresh) {
        if (!noticePending.current) lastNoticeSignature.current = "";
        noticePending.current = true;
      }
      dataRef.current = payload;
      setData(payload);
      setDataOrigin(STATIC_MODE ? "published" : "live");
      const hasStocks = Boolean(payload?.stocks?.length);
      const usable = hasMarketData(payload);
      setStatus(backgroundRefresh && !hasStocks ? "loading" : "ready");
      if (meta.connection_status === "error" && !usable) {
        setError({ message: "Service unavailable", code: "service_unavailable" });
        setStatus("error");
      } else {
        setError(null);
        if (hasStocks) {
          const savedAt = new Date().toISOString();
          writeCachedPublication(payload);
          setBrowserCachedAt(savedAt);
        }
      }
      setLastLoadedAt(new Date());
      if (!backgroundRefresh) {
        if (usable) {
          publishFinalNotice(meta);
        } else {
          noticePending.current = false;
          lastNoticeSignature.current = "empty";
          setDataNotice(null);
        }
      }
      setRefreshing(backgroundRefresh);
      return true;
    } catch (requestError) {
      if (!mounted.current) return false;
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      if (hasMarketData(dataRef.current)) {
        setStatus("ready");
        setDataOrigin("browser-cache");
        setData((current) => current ? {
          ...current,
          meta: { ...current.meta, client_cache: true, cache_state: "cached" },
        } : current);
        dataRef.current = dataRef.current ? {
          ...dataRef.current,
          meta: { ...dataRef.current.meta, client_cache: true, cache_state: "cached" },
        } : null;
        setDataNotice({ id: "cached", key: `cached:${Date.now()}` });
      } else {
        publishFinalNotice(null, requestError);
        setStatus("error");
      }
      return false;
    } finally {
      if (mounted.current && !backgroundRefresh) setRefreshing(false);
    }
  }, [publishFinalNotice]);

  useEffect(() => {
    load({ isRefresh: Boolean(initialCache.current) });
    const interval = STATIC_MODE ? STATIC_REFRESH_INTERVAL_MS : LIVE_REFRESH_INTERVAL_MS;
    const timer = window.setInterval(() => load({ isRefresh: true }), interval);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if ((!refreshing && status !== "loading") || STATIC_MODE) return undefined;
    const timer = window.setInterval(() => load(), 4000);
    return () => window.clearInterval(timer);
  }, [load, refreshing, status]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    noticePending.current = true;
    lastNoticeSignature.current = "";
    if (STATIC_MODE) {
      setRefreshing(false);
      return load({ isRefresh: true, trackCompletion: true, force: true });
    }
    try {
      await api.refresh();
    } catch (requestError) {
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      publishFinalNotice(null, requestError);
      setRefreshing(false);
      return false;
    }
    return load({ trackCompletion: true });
  }, [load, publishFinalNotice]);

  const selectProvider = useCallback(async (providerId) => {
    if (STATIC_MODE) return { ok: false, message: "Provider selection is available in the local service." };
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

  const setStrategyRebalanceFrequency = useCallback((value) => {
    if (!isRebalanceFrequency(value)) return false;
    setStrategyRebalanceFrequencyState(value);
    return true;
  }, []);

  const runBacktest = useCallback(async (config) => {
    const frequency = config.rebalance_frequency || "semiannual";
    setStrategyRebalanceFrequency(frequency);
    const publication = dataRef.current;
    const snapshotBlock = publication?.backtest?.[config.portfolio];
    if (STATIC_MODE) {
      const usesPublishedRange = Boolean(
        snapshotBlock?.available
        && config.start === snapshotBlock.start
        && config.end === snapshotBlock.end,
      );
      if (usesPublishedRange && frequency === "semiannual") {
        return snapshotBlock;
      }
      if (usesPublishedRange) {
        const block = await api.backtestSchedule(config.portfolio, frequency);
        if (!block?.available) {
          throw new Error(`The published ${frequency} ${config.portfolio} backtest is unavailable.`);
        }
        return block;
      }
    }
    return api.backtest(config);
  }, [setStrategyRebalanceFrequency]);

  const value = useMemo(
    () => ({
      data,
      meta: data?.meta ?? null,
      status,
      error,
      refreshing,
      lastLoadedAt,
      dataNotice,
      dataMode: DATA_MODE,
      dataOrigin,
      browserCachedAt,
      staticMode: STATIC_MODE,
      refresh,
      runBacktest,
      selectProvider,
      strategyRebalanceFrequency,
      setStrategyRebalanceFrequency,
      reload: load,
    }),
    [
      browserCachedAt,
      data,
      dataNotice,
      dataOrigin,
      error,
      lastLoadedAt,
      load,
      refresh,
      refreshing,
      runBacktest,
      selectProvider,
      setStrategyRebalanceFrequency,
      strategyRebalanceFrequency,
      status,
    ],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) throw new Error("useMarket must be used inside MarketProvider");
  return context;
}

export function useStockDetail(ticker) {
  const normalizedTicker = String(ticker ?? "").trim().toUpperCase();
  const initialCache = useRef(readCachedStock(normalizedTicker));
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState({
    data: initialCache.current?.data ?? null,
    status: initialCache.current ? "cached" : normalizedTicker ? "loading" : "idle",
    error: null,
    refreshing: Boolean(initialCache.current),
  });
  const reload = useCallback(() => setRequestKey((current) => current + 1), []);

  useEffect(() => {
    if (!normalizedTicker) {
      setState({ data: null, status: "idle", error: null, refreshing: false });
      return undefined;
    }
    const cached = readCachedStock(normalizedTicker);
    let cancelled = false;
    setState({
      data: cached?.data ?? null,
      status: cached ? "cached" : "loading",
      error: null,
      refreshing: Boolean(cached),
    });
    api.stock(normalizedTicker)
      .then((payload) => {
        if (cancelled) return;
        writeCachedStock(normalizedTicker, payload);
        setState({ data: payload, status: "ready", error: null, refreshing: false });
      })
      .catch((requestError) => {
        if (cancelled) return;
        setState((current) => current.data ? {
          ...current,
          status: "cached",
          error: requestError.message,
          refreshing: false,
        } : {
          data: null,
          status: "error",
          error: requestError.message,
          refreshing: false,
        });
      });
    return () => { cancelled = true; };
  }, [normalizedTicker, requestKey]);

  return { ...state, reload };
}

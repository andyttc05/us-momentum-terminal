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
/* Static build + live service: how often to ask the service whether it holds a
   newer publication than the one shipped with the build. */
const LIVE_PROBE_INTERVAL_MS = 3 * 60 * 1000;
/* A forced refresh runs in the service's background, so the new publication is
   collected by polling. 45 × 4s covers a cold 203-ticker warm-up. */
const LIVE_REFRESH_POLL_MS = 4000;
const LIVE_REFRESH_POLLS = 45;
const STATIC_MODE = DATA_MODE === "static";

const sleep = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

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

  /* Writes a publication into state. Shared by the scheduled load and by the
     live probe, which can adopt a newer snapshot without repeating the
     request/notice bookkeeping below. Returns what the caller needs to decide
     on the notice. */
  const applyPayload = useCallback((payload, origin) => {
    const meta = payload?.meta ?? {};
    const backgroundRefresh = Boolean(meta.refresh_in_progress || meta.cache_state === "warming");
    /* Once the live service has handed over a newer publication, the scheduled
       re-read of the published file must not roll it back. Without this the two
       sources would take turns every 15 minutes, each announcing an "update". */
    const incomingAt = Date.parse(meta.generated_at ?? "");
    const currentAt = Date.parse(dataRef.current?.meta?.generated_at ?? "");
    if (origin === "published" && Number.isFinite(incomingAt) && Number.isFinite(currentAt) && incomingAt < currentAt) {
      return { meta, usable: hasMarketData(dataRef.current), backgroundRefresh: false, skipped: true };
    }
    dataRef.current = payload;
    setData(payload);
    setDataOrigin(origin);
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
    return { meta, usable, hasStocks, backgroundRefresh };
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
      const applied = applyPayload(payload, STATIC_MODE ? "published" : "live");
      const { meta, usable, backgroundRefresh: warming } = applied;
      if (applied.skipped) {
        setRefreshing(false);
        return true;
      }
      backgroundRefresh = warming;
      if (backgroundRefresh) {
        if (!noticePending.current) lastNoticeSignature.current = "";
        noticePending.current = true;
      }
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
  }, [applyPayload, publishFinalNotice]);

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

  /* The build ships a snapshot produced when it was deployed, so the data on the
     deployed site could only change when the Pages workflow ran again. When the
     build also names a live service, ask that service whether it holds a newer
     publication and adopt it in place.

     The check is deliberately quiet and cheap: `/health` is a few kilobytes and
     reports how old the service's cached publication is, so nothing downloads a
     four-megabyte snapshot unless there is something newer to fetch. Every
     failure — asleep free instance, cold start, offline — leaves the published
     snapshot on screen and changes nothing else. */
  const checkLive = useCallback(async () => {
    if (!STATIC_MODE || !api.liveService) return false;
    try {
      const health = await api.liveHealth();
      if (!health?.snapshot_ready) return false;
      const ageSeconds = Number(health.snapshot_age_seconds);
      if (!Number.isFinite(ageSeconds)) return false;
      const publishedAt = Date.parse(dataRef.current?.meta?.generated_at ?? "");
      const liveAt = Date.now() - ageSeconds * 1000;
      // A minute of slack absorbs clock skew between the build and the service.
      if (Number.isFinite(publishedAt) && liveAt <= publishedAt + 60_000) return false;
      const payload = await api.liveSnapshot();
      if (!mounted.current) return false;
      /* Never swap good published data for an empty shell: if the service is
         between rebuilds it can answer with a placeholder that carries no
         stocks, and the page would go blank for a dataset nobody asked for. */
      if (!hasMarketData(payload)) return false;
      const applied = applyPayload(payload, "live");
      if (applied.usable) {
        noticePending.current = true;
        lastNoticeSignature.current = "";
        publishFinalNotice(applied.meta);
      }
      return true;
    } catch {
      return false;
    }
  }, [applyPayload, publishFinalNotice]);

  useEffect(() => {
    if (!STATIC_MODE || !api.liveService) return undefined;
    let cancelled = false;
    const tick = () => { if (!cancelled) checkLive(); };
    /* The published snapshot paints first. The early retries walk out to two
       minutes because a free instance that has gone to sleep needs about a
       minute before it answers at all; after that the check settles into its
       regular interval. */
    const early = [4000, 30_000, 60_000, 95_000, 135_000].map((delay) => window.setTimeout(tick, delay));
    const timer = window.setInterval(tick, LIVE_PROBE_INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      early.forEach((id) => window.clearTimeout(id));
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkLive]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    noticePending.current = true;
    lastNoticeSignature.current = "";
    if (STATIC_MODE) {
      /* No service configured: re-read the published file, which is the only
         thing this build can do (and all it needs to do). */
      if (!api.liveService) {
        setRefreshing(false);
        return load({ isRefresh: true, trackCompletion: true, force: true });
      }
      /* The service rebuilds its publication in the background and answers
         /refresh immediately, so the new snapshot is collected by polling until
         the in-progress flag clears. */
      try {
        await api.liveRefresh();
      } catch (requestError) {
        setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
        publishFinalNotice(null, requestError);
        setRefreshing(false);
        return false;
      }
      try {
        for (let attempt = 0; attempt < LIVE_REFRESH_POLLS; attempt += 1) {
          if (!mounted.current) return false;
          await sleep(LIVE_REFRESH_POLL_MS);
          try {
            const payload = await api.liveSnapshot();
            if (!mounted.current) return false;
            if (payload?.meta?.refresh_in_progress) continue;
            if (!hasMarketData(payload)) continue;
            const applied = applyPayload(payload, "live");
            if (applied.usable) publishFinalNotice(applied.meta);
            return true;
          } catch {
            // A restarting instance may refuse a poll; the next round may succeed.
          }
        }
        return false;
      } finally {
        // The button must stop spinning whichever way the wait ended.
        if (mounted.current) setRefreshing(false);
      }
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
  }, [applyPayload, load, publishFinalNotice]);

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

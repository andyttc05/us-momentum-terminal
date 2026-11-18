import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, DATA_MODE } from "./client.js";
import { hasMarketData } from "../utils/dataStatus.js";
import {
  isRebalanceFrequency,
} from "../utils/rebalanceFrequency.js";
import {
  readCachedPublication,
  readCachedStock,
  writeCachedPublication,
  writeCachedStock,
  readRefreshAttempt,
  writeRefreshAttempt,
} from "./dataCache.js";
import {
  publicationMatchesManifest,
  validManifest,
} from "./publicationStatus.js";
import { waitForPublishedRefresh } from "./refreshPolling.js";

const MarketContext = createContext(null);
const STATIC_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const LOCAL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STATIC_MODE = DATA_MODE === "static";
const REFRESH_POLL_INTERVAL_MS = 15 * 1000;
const REFRESH_POLL_TIMEOUT_MS = 12 * 60 * 1000;


function cachedPublicationState() {
  const cached = readCachedPublication();
  if (!cached) return null;
  const publishedCacheState = cached.data.meta.cache_state;
  return {
    ...cached,
    data: {
      ...cached.data,
      meta: {
        ...cached.data.meta,
        client_cache: true,
        published_cache_state: publishedCacheState,
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
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [dataNotice, setDataNotice] = useState(null);
  const [dataOrigin, setDataOrigin] = useState(initialCache.current ? "browser-cache" : "network");
  const [browserCachedAt, setBrowserCachedAt] = useState(initialCache.current?.savedAt ?? null);
  const initialRefreshAttempt = useRef(readRefreshAttempt());
  const [refreshAttempt, setRefreshAttempt] = useState(initialRefreshAttempt.current);
  // A user-selected strategy frequency is app-wide configuration, not a page
  // local draft. Portfolio reads it immediately while the Backtesting selector
  // and completed runs remain the only controls that write it.
  const [strategyRebalanceFrequency, setStrategyRebalanceFrequencyState] = useState(null);
  const mounted = useRef(true);
  const noticePending = useRef(true);
  const lastNoticeSignature = useRef("");
  const checkOperation = useRef(null);
  const refreshOperation = useRef(null);
  const refreshResumeAttempted = useRef(false);

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

  /* Writes a validated publication into state and preserves the last-good copy. */
  const applyPayload = useCallback((payload, origin) => {
    const meta = payload?.meta ?? {};
    const backgroundRefresh = Boolean(meta.refresh_in_progress || meta.cache_state === "warming");
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

  const markPublicationVerified = useCallback(() => {
    if (!dataRef.current?.meta?.client_cache) return;
    const publishedCacheState = dataRef.current.meta.published_cache_state;
    const verified = {
      ...dataRef.current,
      meta: {
        ...dataRef.current.meta,
        client_cache: false,
        published_cache_state: undefined,
        cache_state: publishedCacheState || "fresh",
      },
    };
    dataRef.current = verified;
    setData(verified);
    setDataOrigin("published");
  }, []);

  /* Manifest-first static loading keeps an already-rendered browser snapshot
     on screen and usually transfers only a few KB. A full publication is read
     only when its version, collection timestamp, or market date changed. */
  const checkPublishedSnapshot = useCallback(async () => {
    const manifest = await api.manifest({ force: true });
    if (!validManifest(manifest)) {
      throw new ApiError("The published data manifest is invalid.", { code: "invalid_manifest" });
    }
    if (dataRef.current && publicationMatchesManifest(dataRef.current, manifest)) {
      markPublicationVerified();
      setLastLoadedAt(new Date());
      return { changed: false, payload: dataRef.current, manifest };
    }
    const payload = await api.snapshot({ force: true });
    if (!publicationMatchesManifest(payload, manifest)) {
      throw new ApiError("The published data does not match its manifest yet. Please try again shortly.", {
        code: "publication_mismatch",
      });
    }
    const applied = applyPayload(payload, "published");
    return { changed: !applied.skipped, payload, manifest, ...applied };
  }, [applyPayload, markPublicationVerified]);

  const load = useCallback(async ({ isRefresh = false, trackCompletion = false, force = false } = {}) => {
    if (isRefresh) setRefreshing(true);
    if (trackCompletion) {
      noticePending.current = true;
      lastNoticeSignature.current = "";
    }
    let backgroundRefresh = false;
    try {
      const staticResult = STATIC_MODE ? await checkPublishedSnapshot() : null;
      const payload = staticResult?.payload ?? await api.snapshot({ force });
      if (!mounted.current) return false;
      const applied = STATIC_MODE
        ? (staticResult?.changed ? staticResult : { meta: payload?.meta ?? {}, usable: hasMarketData(payload), backgroundRefresh: false })
        : applyPayload(payload, "live");
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
        const shouldPublishNotice = !STATIC_MODE || !staticResult || staticResult.changed;
        if (usable && shouldPublishNotice) {
          publishFinalNotice(meta);
        } else if (!usable) {
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
  }, [applyPayload, checkPublishedSnapshot, publishFinalNotice]);

  useEffect(() => {
    load({ isRefresh: Boolean(initialCache.current) });
    const interval = STATIC_MODE ? STATIC_REFRESH_INTERVAL_MS : LOCAL_REFRESH_INTERVAL_MS;
    const timer = window.setInterval(() => load({ isRefresh: true }), interval);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const pending = initialRefreshAttempt.current;
    if (
      !STATIC_MODE
      || refreshResumeAttempted.current
      || !pending
      || !["updating", "queued"].includes(pending.state)
    ) return undefined;
    refreshResumeAttempted.current = true;
    let cancelled = false;
    let settled = false;
    const requested = Date.parse(pending.requestedAt);
    const remaining = Number.isFinite(requested)
      ? REFRESH_POLL_TIMEOUT_MS - Math.max(0, Date.now() - requested)
      : 0;

    if (remaining <= 0) {
      const failed = {
        ...pending,
        state: "failed",
        completedAt: new Date().toISOString(),
        result: "The refresh did not finish before it timed out.",
        code: "refresh_timeout",
      };
      settled = true;
      setRefreshAttempt(failed);
      writeRefreshAttempt(failed);
      return undefined;
    }

    if (mounted.current) setRefreshing(true);
    waitForPublishedRefresh({
      timeoutMs: remaining,
      intervalMs: REFRESH_POLL_INTERVAL_MS,
      check: async () => mounted.current ? checkPublishedSnapshot() : { changed: true, cancelled: true },
    }).then((result) => {
      if (cancelled || result.cancelled) return;
      const completed = {
        ...pending,
        state: "updated",
        completedAt: new Date().toISOString(),
        result: "Published update available",
        generatedAt: result.payload?.meta?.generated_at,
      };
      settled = true;
      setRefreshAttempt(completed);
      writeRefreshAttempt(completed);
      publishFinalNotice(result.payload?.meta);
    }).catch((requestError) => {
      if (cancelled) return;
      const failed = {
        ...pending,
        state: "failed",
        completedAt: new Date().toISOString(),
        result: requestError.message,
        code: requestError.code ?? "refresh_failed",
      };
      settled = true;
      setRefreshAttempt(failed);
      writeRefreshAttempt(failed);
      setError({ message: requestError.message, code: failed.code });
      setDataNotice({ id: "error", key: `refresh:${Date.now()}` });
    }).finally(() => {
      if (!cancelled && mounted.current) setRefreshing(false);
    });

    return () => {
      cancelled = true;
      if (!settled) refreshResumeAttempted.current = false;
    };
  }, [checkPublishedSnapshot, publishFinalNotice]);

  useEffect(() => {
    if ((!refreshing && status !== "loading") || STATIC_MODE) return undefined;
    const timer = window.setInterval(() => load(), 4000);
    return () => window.clearInterval(timer);
  }, [load, refreshing, status]);

  const checkForUpdates = useCallback(async () => {
    if (checkOperation.current || refreshOperation.current) return false;
    const operation = {};
    checkOperation.current = operation;
    setCheckingForUpdates(true);
    try {
      setRefreshing(true);
      noticePending.current = true;
      lastNoticeSignature.current = "";
      if (STATIC_MODE) {
        return await load({ isRefresh: true, trackCompletion: true, force: true });
      }
      await api.refresh();
      return await load({ trackCompletion: true });
    } catch (requestError) {
      setError({ message: requestError.message, code: requestError.code ?? "request_failed" });
      publishFinalNotice(null, requestError);
      return false;
    } finally {
      if (checkOperation.current === operation) checkOperation.current = null;
      if (mounted.current) {
        setCheckingForUpdates(false);
        setRefreshing(false);
      }
    }
  }, [load, publishFinalNotice]);

  const refreshMarketData = useCallback(async ({
    challengeToken = null,
    requestError = null,
  } = {}) => {
    if (refreshOperation.current || checkOperation.current) return false;
    if (!STATIC_MODE) return checkForUpdates();
    const operation = {};
    refreshOperation.current = operation;
    setRefreshing(true);
    const requestedAt = new Date().toISOString();
    const requested = { state: "updating", requestedAt, result: "Refresh requested" };
    setRefreshAttempt(requested);
    writeRefreshAttempt(requested);
    try {
      if (requestError) throw requestError;
      const response = await api.requestMarketRefresh(challengeToken);
      if (!response?.accepted) {
        throw new ApiError("The refresh service did not queue an update.", { code: "refresh_rejected" });
      }
      const accepted = {
        ...requested,
        state: response.alreadyRunning ? "updating" : "queued",
        result: response.alreadyRunning ? "An update is already running" : "Refresh queued",
      };
      setRefreshAttempt(accepted);
      writeRefreshAttempt(accepted);

      const result = await waitForPublishedRefresh({
        timeoutMs: REFRESH_POLL_TIMEOUT_MS,
        intervalMs: REFRESH_POLL_INTERVAL_MS,
        check: async () => mounted.current ? checkPublishedSnapshot() : { changed: true, cancelled: true },
      });
      if (result.cancelled) return false;
      const completed = {
        state: "updated", requestedAt, completedAt: new Date().toISOString(),
        result: "Published update available", generatedAt: result.payload?.meta?.generated_at,
      };
      setRefreshAttempt(completed);
      writeRefreshAttempt(completed);
      setRefreshing(false);
      publishFinalNotice(result.payload?.meta);
      return true;
    } catch (requestError) {
      const failed = {
        state: "failed", requestedAt, completedAt: new Date().toISOString(),
        result: requestError.message, code: requestError.code ?? "refresh_failed",
      };
      setRefreshAttempt(failed);
      writeRefreshAttempt(failed);
      setError({ message: requestError.message, code: failed.code });
      setDataNotice({ id: "error", key: `refresh:${Date.now()}` });
      return false;
    } finally {
      if (refreshOperation.current === operation) refreshOperation.current = null;
      if (mounted.current) setRefreshing(false);
    }
  }, [checkForUpdates, checkPublishedSnapshot, publishFinalNotice]);

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
      throw new Error("Custom-date browser calculations are not available yet; no server request was made.");
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
      checkingForUpdates,
      refreshAttempt,
      staticMode: STATIC_MODE,
      // Existing page-level refresh controls are deliberately only manifest
      // checks; the explicit dialog action below is the privileged operation.
      refresh: checkForUpdates,
      checkForUpdates,
      refreshMarketData,
      refreshBrokerEnabled: api.refreshBrokerEnabled,
      runBacktest,
      selectProvider,
      strategyRebalanceFrequency,
      setStrategyRebalanceFrequency,
      reload: load,
    }),
    [
      browserCachedAt,
      checkingForUpdates,
      data,
      dataNotice,
      dataOrigin,
      error,
      lastLoadedAt,
      load,
      checkForUpdates,
      refreshAttempt,
      refreshMarketData,
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

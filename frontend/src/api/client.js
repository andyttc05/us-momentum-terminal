// Thin fetch wrapper for the optional live service and the static publication.
// Provider API keys always stay on the server.
//
// Local development leaves VITE_API_BASE_URL unset, so requests keep using the
// Vite proxy (`/api` -> the local FastAPI service). The normal GitHub Pages
// build uses same-origin static JSON from VITE_DATA_MODE=static.

import { DATA_REQUEST_TIMEOUT_MS } from "./timeouts.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const BACKTEST_API_BASE = import.meta.env.VITE_BACKTEST_API_BASE_URL || API_BASE;
const STATIC_BASE = `${import.meta.env.BASE_URL || "/"}data`;
export const DATA_MODE = import.meta.env.VITE_DATA_MODE
  || (import.meta.env.PROD ? "static" : "live");

/* The deployed Pages build ships the published JSON *and* points
   VITE_API_BASE_URL at the live service. That combination is intentional: the
   snapshot paints from the static files immediately, and the provider then asks
   the service whether it holds something newer (see MarketProvider's live
   probe). Empty in a build with no service configured, which is what makes the
   static delivery still work on its own. */
export const LIVE_API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const inFlight = new Map();

function dedupe(key, task) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = task().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = "request_failed" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path, {
  method = "GET",
  timeout = DATA_REQUEST_TIMEOUT_MS,
  body,
  base = API_BASE,
} = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.detail) detail = payload.detail;
      } catch {
        // keep the status-based message
      }
      const code = response.status === 503 ? "warming" : response.status >= 500 ? "provider" : "request_failed";
      const message = /^HTTP \d+$/.test(detail)
        ? "The market data service is unreachable. No substitute data is shown."
        : detail;
      throw new ApiError(message, { status: response.status, code });
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") {
      throw new ApiError("The data service did not respond in time.", { code: "timeout" });
    }
    throw new ApiError("Cannot reach the market data service.", { code: "offline" });
  } finally {
    window.clearTimeout(timer);
  }
}

async function staticRequest(path, { timeout = 20_000, noCache = false } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  const separator = path.includes("?") ? "&" : "?";
  const url = `${STATIC_BASE}/${path}${noCache ? `${separator}v=${Date.now()}` : ""}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: noCache ? "no-cache" : "default",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError(
        response.status === 404
          ? "The published market-data snapshot is unavailable."
          : `Published data request failed (HTTP ${response.status}).`,
        { status: response.status, code: response.status === 404 ? "missing_snapshot" : "static_failed" },
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") {
      throw new ApiError("The published market-data snapshot did not respond in time.", { code: "timeout" });
    }
    throw new ApiError("Cannot load the published market-data snapshot.", { code: "offline" });
  } finally {
    window.clearTimeout(timer);
  }
}

export const api = {
  dataMode: DATA_MODE,
  /* True when the build was given a live service URL. The provider uses it to
     decide whether a background check is worth running at all. */
  liveService: Boolean(LIVE_API_BASE),
  snapshot: ({ force = false } = {}) => {
    if (DATA_MODE !== "static") return request("/snapshot");
    const key = force ? `snapshot:${Date.now()}` : "snapshot";
    return dedupe(key, () => staticRequest("publication.json", { noCache: force }));
  },
  /* Live-service reads, used by the static build to pick up a newer publication
     than the one it shipped with. `/health` is a few kilobytes and carries the
     age of the service's cached publication, so it answers "is there anything
     newer?" without downloading a 4MB snapshot on every poll. */
  liveHealth: () => request("/health", { base: LIVE_API_BASE, timeout: 30_000 }),
  liveSnapshot: () => request("/snapshot", { base: LIVE_API_BASE, timeout: 90_000 }),
  liveRefresh: () => request("/refresh", { method: "POST", base: LIVE_API_BASE, timeout: 30_000 }),
  stock: (ticker) => {
    const symbol = String(ticker ?? "").trim().toUpperCase();
    if (DATA_MODE !== "static") return request(`/stock/${encodeURIComponent(symbol)}`);
    return dedupe(`stock:${symbol}`, async () => {
      /* The published detail file is the fast path. A ticker that only exists
         in a newer live universe has no file yet, so the service answers for it
         rather than the page showing an error. */
      try {
        return await staticRequest(`stocks/${encodeURIComponent(symbol)}.json`);
      } catch (error) {
        if (!LIVE_API_BASE || error?.status !== 404) throw error;
        return request(`/stock/${encodeURIComponent(symbol)}`, { base: LIVE_API_BASE });
      }
    });
  },
  manifest: () => (
    DATA_MODE === "static"
      ? dedupe("manifest", () => staticRequest("manifest.json"))
      : request("/config")
  ),
  bars: (ticker, days = 750) => request(`/bars/${encodeURIComponent(ticker)}?days=${days}`),
  backtestSchedule: (portfolio, frequency) => dedupe(
    `backtest:${portfolio}:${frequency}`,
    () => staticRequest(`backtests/${encodeURIComponent(portfolio)}/${encodeURIComponent(frequency)}.json`),
  ),
  health: () => request("/health"),
  providers: () => request("/providers"),
  probe: () => request("/probe"),
  backtest: (config) => request("/backtest", {
    method: "POST",
    body: config,
    timeout: 180_000,
    base: BACKTEST_API_BASE,
  }),
  refresh: () => (
    DATA_MODE === "static"
      ? staticRequest("publication.json", { noCache: true })
      : request("/refresh", { method: "POST", timeout: 120_000 })
  ),
  setProvider: (id) => request("/provider", { method: "POST", body: { id }, timeout: 180_000 }),
};

// Production reads only same-origin GitHub Pages JSON. Local development lazily
// loads a separate adapter that talks to the Vite-proxied FastAPI process.
const STATIC_BASE = `${import.meta.env.BASE_URL || "/"}data`;
export const DATA_MODE = import.meta.env.VITE_DATA_MODE
  || (import.meta.env.PROD ? "static" : "live");
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

async function staticRequest(path, { timeout = 20_000, revalidate = false } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  const url = `${STATIC_BASE}/${path}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      // no-cache revalidates a browser/CDN entry using validators when
      // available; a timestamp query would defeat that inexpensive check.
      cache: revalidate ? "no-cache" : "default",
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

const REFRESH_BROKER_URL = String(import.meta.env.VITE_REFRESH_BROKER_URL || "").replace(/\/$/, "");

async function requestRefreshBroker(challengeToken) {
  if (!REFRESH_BROKER_URL) {
    throw new ApiError("Market refresh is not configured for this deployment.", { code: "refresh_unavailable" });
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${REFRESH_BROKER_URL}/api/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // This token is a short-lived public anti-bot assertion (for example
      // Turnstile), never a GitHub credential.
      body: JSON.stringify({ challengeToken }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(body?.message || "The refresh request was not accepted.", {
        status: response.status,
        code: body?.code || "refresh_rejected",
      });
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") throw new ApiError("The refresh request timed out.", { code: "refresh_timeout" });
    throw new ApiError("Cannot reach the secure refresh service.", { code: "refresh_offline" });
  } finally {
    window.clearTimeout(timer);
  }
}

async function requestRefreshStatus(requestId) {
  if (!REFRESH_BROKER_URL || !requestId) {
    throw new ApiError("The refresh status is unavailable.", { code: "refresh_status_unavailable" });
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `${REFRESH_BROKER_URL}/api/status?requestId=${encodeURIComponent(requestId)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(body?.message || "Refresh status is unavailable.", {
        status: response.status,
        code: body?.code || "refresh_status_unavailable",
      });
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") {
      throw new ApiError("Refresh status timed out.", { code: "refresh_status_timeout" });
    }
    throw new ApiError("Refresh status is unavailable.", { code: "refresh_status_unavailable" });
  } finally {
    window.clearTimeout(timer);
  }
}

async function devCall(method, ...args) {
  if (!import.meta.env.DEV) throw new Error("The local data service is only available in development.");
  const developmentApi = await import("./devClient.js");
  return developmentApi[method](...args);
}

export const api = {
  dataMode: DATA_MODE,
  snapshot: ({ force = false } = {}) => DATA_MODE === "static"
    ? dedupe(force ? "snapshot:revalidate" : "snapshot", () => staticRequest("publication.json", { revalidate: force }))
    : devCall("snapshot"),
  stock: (ticker) => {
    const symbol = String(ticker ?? "").trim().toUpperCase();
    return DATA_MODE === "static"
      ? dedupe(`stock:${symbol}`, () => staticRequest(`stocks/${encodeURIComponent(symbol)}.json`))
      : devCall("stock", symbol);
  },
  manifest: ({ force = false } = {}) => DATA_MODE === "static"
    ? dedupe(force ? "manifest:revalidate" : "manifest", () => staticRequest("manifest.json", { revalidate: force }))
    : devCall("manifest"),
  backtestSchedule: (portfolio, frequency) => dedupe(
    `backtest:${portfolio}:${frequency}`,
    () => staticRequest(`backtests/${encodeURIComponent(portfolio)}/${encodeURIComponent(frequency)}.json`),
  ),
  backtestInputs: () => dedupe("backtest-inputs", () => staticRequest("backtest-inputs.json", { timeout: 90_000 })),
  backtest: (config) => devCall("backtest", config),
  refresh: () => DATA_MODE === "static" ? staticRequest("publication.json", { revalidate: true }) : devCall("refresh"),
  requestMarketRefresh: (challengeToken) => DATA_MODE === "static"
    ? requestRefreshBroker(challengeToken)
    : devCall("refresh"),
  refreshStatus: (requestId) => DATA_MODE === "static"
    ? requestRefreshStatus(requestId)
    : Promise.resolve({ status: "idle" }),
  refreshBrokerEnabled: Boolean(REFRESH_BROKER_URL),
  setProvider: (id) => devCall("setProvider", id),
};

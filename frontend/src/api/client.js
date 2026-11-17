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

async function devCall(method, ...args) {
  if (!import.meta.env.DEV) throw new Error("The local data service is only available in development.");
  const developmentApi = await import("./devClient.js");
  return developmentApi[method](...args);
}

export const api = {
  dataMode: DATA_MODE,
  snapshot: ({ force = false } = {}) => DATA_MODE === "static"
    ? dedupe(force ? `snapshot:${Date.now()}` : "snapshot", () => staticRequest("publication.json", { noCache: force }))
    : devCall("snapshot"),
  stock: (ticker) => {
    const symbol = String(ticker ?? "").trim().toUpperCase();
    return DATA_MODE === "static"
      ? dedupe(`stock:${symbol}`, () => staticRequest(`stocks/${encodeURIComponent(symbol)}.json`))
      : devCall("stock", symbol);
  },
  manifest: () => DATA_MODE === "static"
    ? dedupe("manifest", () => staticRequest("manifest.json"))
    : devCall("manifest"),
  backtestSchedule: (portfolio, frequency) => dedupe(
    `backtest:${portfolio}:${frequency}`,
    () => staticRequest(`backtests/${encodeURIComponent(portfolio)}/${encodeURIComponent(frequency)}.json`),
  ),
  backtestInputs: () => dedupe("backtest-inputs", () => staticRequest("backtest-inputs.json", { timeout: 90_000 })),
  backtest: (config) => devCall("backtest", config),
  refresh: () => DATA_MODE === "static" ? staticRequest("publication.json", { noCache: true }) : devCall("refresh"),
  setProvider: (id) => devCall("setProvider", id),
};

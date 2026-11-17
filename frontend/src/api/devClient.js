// Development-only adapter. This module is loaded dynamically only in local
// Vite sessions and is absent from the production Pages bundle.
const BASE = "/api";
async function request(path, { method = "GET", body, timeout = 90_000 } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || `Local data request failed (HTTP ${response.status}).`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}
export const snapshot = () => request("/snapshot");
export const stock = (symbol) => request(`/stock/${encodeURIComponent(symbol)}`);
export const manifest = () => request("/config");
export const backtest = (config) => request("/backtest", { method: "POST", body: config, timeout: 180_000 });
export const refresh = () => request("/refresh", { method: "POST", timeout: 120_000 });
export const setProvider = (id) => request("/provider", { method: "POST", body: { id }, timeout: 180_000 });

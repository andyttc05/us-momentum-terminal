// Thin fetch wrapper for the local data service. The browser only ever talks to
// this origin (/api/...); provider API keys stay on the server.

const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = "request_failed" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = "GET", timeout = TIMEOUT_MS, body } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`/api${path}`, {
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

export const api = {
  snapshot: () => request("/snapshot"),
  stock: (ticker) => request(`/stock/${encodeURIComponent(ticker)}`),
  bars: (ticker, days = 750) => request(`/bars/${encodeURIComponent(ticker)}?days=${days}`),
  health: () => request("/health"),
  providers: () => request("/providers"),
  probe: () => request("/probe"),
  refresh: () => request("/refresh", { method: "POST", timeout: 120_000 }),
  setProvider: (id) => request("/provider", { method: "POST", body: { id }, timeout: 180_000 }),
};

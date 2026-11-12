import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Minimal history-API router.
 *
 * Routes:
 *   /                 Overview
 *   /screener         Screener
 *   /portfolio        Portfolio
 *   /backtesting      Backtesting
 *   /stock/:ticker    Stock Analysis (ticker is URL-encoded)
 *
 * Pages stay mounted while hidden (see App.jsx), so filters, search, sorting
 * and pagination survive a trip to Stock Analysis and back.
 */

const PAGES = ["overview", "screener", "portfolio", "backtesting"];

const RouterContext = createContext(null);

// The site can be served from a repository subpath on GitHub Pages. Vite's base
// (import.meta.env.BASE_URL) is "/" locally and "/us-momentum-terminal/" on
// Pages. We keep the router's own paths base-free and only add the base back
// when writing to the browser URL, so the same logic works in both places.
const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

/** The browser-facing URL for an app-internal path (adds the base prefix). */
export function publicPath(path) {
  return `${BASE_PATH}${path}`;
}

export function normalizePath(path) {
  if (!path) return "/";
  let withoutQuery = path.split("?")[0].split("#")[0];
  if (BASE_PATH && (withoutQuery === BASE_PATH || withoutQuery.startsWith(`${BASE_PATH}/`))) {
    withoutQuery = withoutQuery.slice(BASE_PATH.length);
  }
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

export function parseRoute(path) {
  const stock = normalizePath(path).match(/^\/stock\/([^/]+)$/);
  if (stock) {
    let ticker = stock[1];
    try {
      ticker = decodeURIComponent(ticker);
    } catch {
      // keep the raw segment when it is not valid percent-encoding
    }
    return { page: "stock-analysis", ticker: ticker.trim().toUpperCase() };
  }
  const segment = normalizePath(path).replace(/^\//, "");
  if (PAGES.includes(segment)) return { page: segment, ticker: null };
  return { page: "overview", ticker: null };
}

export function RouterProvider({ children }) {
  const [route, setRoute] = useState(() => ({
    path: normalizePath(window.location.pathname),
    state: window.history.state ?? null,
  }));

  useEffect(() => {
    function onPopState() {
      setRoute({ path: normalizePath(window.location.pathname), state: window.history.state ?? null });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const parsed = parseRoute(route.path);
    const pageName = parsed.page === "stock-analysis"
      ? `${parsed.ticker} Stock Analysis`
      : parsed.page.charAt(0).toUpperCase() + parsed.page.slice(1);
    document.title = `${pageName} | US Momentum Terminal`;
  }, [route.path]);

  const navigate = useCallback((to, { replace = false, state = null } = {}) => {
    const target = normalizePath(to);
    if (target === normalizePath(window.location.pathname) && !replace) return;
    if (replace) window.history.replaceState(state, "", publicPath(target));
    else window.history.pushState(state, "", publicPath(target));
    setRoute({ path: target, state });
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => {
    const parsed = parseRoute(route.path);
    return { path: route.path, historyState: route.state, navigate, ...parsed };
  }, [navigate, route]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used inside RouterProvider");
  return context;
}

/** The single place that builds a stock URL. Everything routes through this. */
export function stockPath(ticker) {
  return `/stock/${encodeURIComponent(String(ticker).trim().toUpperCase())}`;
}

export function useStockNavigation() {
  const { navigate, path } = useRouter();
  return useCallback(
    (ticker) => {
      const symbol = String(ticker ?? "").trim().toUpperCase();
      if (!symbol) return;
      navigate(stockPath(symbol), { state: { from: path } });
    },
    [navigate, path],
  );
}

const BACK_LABELS = {
  "/": "Overview",
  "/overview": "Overview",
  "/screener": "Screener",
  "/portfolio": "Portfolio",
  "/backtesting": "Backtesting",
};

export function backLabelFor(from) {
  if (!from) return "Screener";
  return BACK_LABELS[from] ?? "Back";
}

export function backPathFor(from) {
  if (!from || !(from in BACK_LABELS)) return "/screener";
  return from;
}

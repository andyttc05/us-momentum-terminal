export const UNIVERSE_STORAGE_KEY = "umt:universe:v1";
export const ACTIVE_UNIVERSE_STORAGE_KEY = "umt:active-universe:v1";
export const DEFAULT_UNIVERSE = "top100";
export const UNIVERSE_OPTIONS = Object.freeze([
  Object.freeze({ value: "top100", label: "Top 100" }),
  Object.freeze({ value: "top20", label: "Top 20" }),
]);

const UNIVERSE_VALUES = new Set(UNIVERSE_OPTIONS.map(({ value }) => value));

export function normalizeUniverse(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return UNIVERSE_VALUES.has(normalized) ? normalized : DEFAULT_UNIVERSE;
}

export function universeLabel(value) {
  const normalized = normalizeUniverse(value);
  return UNIVERSE_OPTIONS.find(({ value: option }) => option === normalized)?.label ?? "Top 100";
}

export function holdingCountForUniverse(value) {
  return normalizeUniverse(value) === "top20" ? 20 : 100;
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readUniverseSelection(storage = browserStorage()) {
  try {
    return normalizeUniverse(storage?.getItem(UNIVERSE_STORAGE_KEY));
  } catch {
    return DEFAULT_UNIVERSE;
  }
}

export function writeUniverseSelection(value, storage = browserStorage()) {
  const normalized = normalizeUniverse(value);
  try {
    storage?.setItem(UNIVERSE_STORAGE_KEY, normalized);
    return Boolean(storage);
  } catch {
    return false;
  }
}

/**
 * The dataset the pages are showing. It is not the same thing as the universe
 * selected for the next backtest: editing the Backtesting selector must not
 * relabel results that were already computed for the other universe.
 */
export function readActiveUniverse(fallback = DEFAULT_UNIVERSE, storage = browserStorage()) {
  try {
    const stored = storage?.getItem(ACTIVE_UNIVERSE_STORAGE_KEY);
    return stored ? normalizeUniverse(stored) : normalizeUniverse(fallback);
  } catch {
    return normalizeUniverse(fallback);
  }
}

export function writeActiveUniverse(value, storage = browserStorage()) {
  const normalized = normalizeUniverse(value);
  try {
    storage?.setItem(ACTIVE_UNIVERSE_STORAGE_KEY, normalized);
    return Boolean(storage);
  } catch {
    return false;
  }
}

function stockIndex(stocks) {
  const index = new Map();
  (stocks ?? []).forEach((stock) => {
    if (stock?.ticker) index.set(stock.ticker, stock);
  });
  return index;
}

/**
 * Publications before the per-universe dataset schema only carried one
 * (Top 100) scope. It is still valid Top 100 data, so it is served as that
 * dataset and nothing else — a Top 20 view is never faked from it.
 */
function legacyDataset(data, universe) {
  if (universe !== DEFAULT_UNIVERSE) return null;
  const overview = data?.overview;
  const stocks = data?.stocks;
  if (!overview && !stocks?.length) return null;
  const portfolio = data?.portfolios?.[universe] ?? data?.portfolio ?? null;
  const count = portfolio?.summary?.totalHoldings ?? portfolio?.holdings?.length ?? 0;
  return {
    universe,
    legacy: true,
    meta: {
      universe,
      targetHoldings: holdingCountForUniverse(universe),
      selectedCount: count,
      calculationDate: data?.meta?.as_of ?? overview?.snapshot?.asOf ?? null,
      dataTimestamp: data?.meta?.generated_at ?? null,
      runId: null,
      status: portfolio?.available ? "success" : "unavailable",
    },
    stockTickers: (stocks ?? []).slice(0, holdingCountForUniverse(universe)).map((stock) => stock.ticker),
    portfolio,
    overview,
  };
}

/**
 * Resolve one published dataset, with its stock list already expanded from the
 * single ranked universe so the table, the metrics and the exports can never
 * describe different names.
 */
export function datasetForUniverse(data, universe) {
  const normalized = normalizeUniverse(universe);
  const dataset = data?.datasets?.[normalized] ?? legacyDataset(data, normalized);
  if (!dataset) return null;
  const index = stockIndex(data?.stocks);
  const tickers = dataset.stockTickers ?? [];
  const stocks = tickers.length
    ? tickers.map((ticker) => index.get(ticker)).filter(Boolean)
    : [];
  return { ...dataset, stocks };
}

/** The portfolio that belongs to the resolved dataset (never another universe's book). */
export function portfolioForUniverse(data, universe) {
  const dataset = datasetForUniverse(data, universe);
  if (dataset?.portfolio) return dataset.portfolio;
  const normalized = normalizeUniverse(universe);
  if (dataset) return null;
  const selected = data?.portfolios?.[normalized];
  if (selected) return selected;
  return normalized === DEFAULT_UNIVERSE ? data?.portfolio ?? null : null;
}

/** Target holdings for the active dataset, not a hardcoded universe constant. */
export function targetHoldingsForDataset(dataset, universe) {
  return (
    dataset?.meta?.targetHoldings
    ?? dataset?.portfolio?.targetHoldings
    ?? holdingCountForUniverse(universe)
  );
}

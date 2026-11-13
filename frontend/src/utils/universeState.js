export const UNIVERSE_STORAGE_KEY = "umt:universe:v1";
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
 * Resolve the portfolio that belongs to the selected universe. The legacy
 * top-level portfolio remains the Top 100 fallback for older cached
 * publications; a missing Top 20 book must never silently show Top 100 data.
 */
export function portfolioForUniverse(data, universe) {
  const normalized = normalizeUniverse(universe);
  const selected = data?.portfolios?.[normalized];
  if (selected) return selected;
  return normalized === DEFAULT_UNIVERSE ? data?.portfolio ?? null : null;
}

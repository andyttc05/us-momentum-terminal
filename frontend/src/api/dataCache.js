const PUBLICATION_KEY = "umt:publication:v1";
const DETAIL_PREFIX = "umt:stock:";

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRecord(key) {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRecord(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Browsers can deny storage in private modes or when the quota is full.
  }
}

export function readCachedPublication() {
  const record = readRecord(PUBLICATION_KEY);
  const data = record?.data;
  if (!record?.savedAt || !Array.isArray(data?.stocks) || !data?.meta) return null;
  return record;
}

export function writeCachedPublication(data) {
  if (!Array.isArray(data?.stocks) || !data?.meta) return;
  writeRecord(PUBLICATION_KEY, { savedAt: new Date().toISOString(), data });
}

export function readCachedStock(ticker) {
  if (!ticker) return null;
  const record = readRecord(`${DETAIL_PREFIX}${ticker.toUpperCase()}`);
  return record?.data?.ticker === ticker.toUpperCase() ? record : null;
}

export function writeCachedStock(ticker, data) {
  if (!ticker || data?.ticker !== ticker.toUpperCase()) return;
  writeRecord(`${DETAIL_PREFIX}${ticker.toUpperCase()}`, {
    savedAt: new Date().toISOString(),
    data,
  });
}

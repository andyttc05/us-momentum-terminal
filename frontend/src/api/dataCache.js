import { validPublication } from "./publicationStatus.js";

const PUBLICATION_KEY = "umt:publication:v1";
const DETAIL_PREFIX = "umt:stock:";
const REFRESH_ATTEMPT_KEY = "umt:refresh-attempt:v1";

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
    return true;
  } catch {
    // Browsers can deny storage in private modes or when the quota is full.
    return false;
  }
}

function clearRecord(key) {
  try {
    storage()?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function removeRecord(key) {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to do: storage is unavailable either way.
  }
}

/**
 * Largest publication that may be cached.
 *
 * A browser origin gets roughly 5 MB of localStorage, and the record wrapper
 * and JSON escaping add to the payload. Above this the write throws
 * QuotaExceededError and — silently — leaves whatever older snapshot was
 * already stored, so the page kept painting a months-old date on every visit.
 * Refusing oversized snapshots explicitly, and dropping the unreplaceable old
 * copy, is what stops that.
 */
const MAX_PUBLICATION_CHARS = 3_500_000;

export function readCachedPublication() {
  const record = readRecord(PUBLICATION_KEY);
  const data = record?.data;
  if (!record?.savedAt || !validPublication(data)) return null;
  return record;
}

/**
 * Cache the last valid snapshot for the next first paint.
 *
 * Returns whether the snapshot actually fits. A snapshot that does not fit is
 * not a silent no-op: any older copy is removed, because a copy that can never
 * be replaced would otherwise be shown as if it were current forever.
 */
export function writeCachedPublication(data) {
  if (!validPublication(data)) return false;
  let serialized;
  try {
    serialized = JSON.stringify({ savedAt: new Date().toISOString(), data });
  } catch {
    return false;
  }
  if (serialized.length > MAX_PUBLICATION_CHARS) {
    removeRecord(PUBLICATION_KEY);
    return false;
  }
  try {
    storage()?.setItem(PUBLICATION_KEY, serialized);
    return true;
  } catch {
    removeRecord(PUBLICATION_KEY);
    return false;
  }
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

export function readRefreshAttempt() {
  const record = readRecord(REFRESH_ATTEMPT_KEY);
  return record && typeof record === "object" && record.requestedAt ? record : null;
}

export function writeRefreshAttempt(attempt) {
  if (!attempt?.requestedAt) return;
  writeRecord(REFRESH_ATTEMPT_KEY, attempt);
}

/** Forget an attempt that outlived its polling window instead of failing it. */
export function clearRefreshAttempt() {
  clearRecord(REFRESH_ATTEMPT_KEY);
}

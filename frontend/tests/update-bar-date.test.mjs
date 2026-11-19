/**
 * The update-bar date must never name a snapshot the page has not confirmed.
 *
 * The pill paints the browser's cached snapshot immediately. Until the small
 * manifest confirms it, the date shown would be the *cached* one, and when the
 * cache was behind the reader saw it change a moment later ("Nov 15" turning
 * into today). These tests pin both halves of the fix: the placeholder while
 * unconfirmed, and a cache that can never be left holding an unreplaceable
 * snapshot.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const updateBar = read("../src/components/UpdateBar.jsx");
const layoutCss = read("../src/styles/layout.css");

function validPublication(overrides = {}) {
  return {
    meta: {
      connection_status: "connected",
      publication_version: "2026-11-19-test",
      generated_at: "2026-11-19T15:51:39+00:00",
      as_of: "2026-11-18",
      staticSnapshot: {
        publicationVersion: "2026-11-19-test",
        generatedAt: "2026-11-19T15:51:39+00:00",
        asOf: "2026-11-18",
      },
    },
    stocks: [{ ticker: "AAA" }],
    universe: { requested: 1, loaded: 1, partial: false, unavailable: [] },
    portfolios: { top100: { available: true }, top20: { available: true } },
    backtest: { top100: { available: true }, top20: { available: true } },
    ...overrides,
  };
}

/** A storage stub with a real quota, so an oversized write throws like a browser. */
function installStorage(limitChars) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        if (value.length + key.length > limitChars) {
          const error = new Error("The quota has been exceeded.");
          error.name = "QuotaExceededError";
          throw error;
        }
        store.set(key, value);
      },
      removeItem: (key) => { store.delete(key); },
    },
  };
  return store;
}

test("the date slot shows a placeholder until the snapshot is confirmed", () => {
  assert.match(updateBar, /const datePending = Boolean\(\s*hasData[\s\S]*?dataOrigin === "browser-cache"[\s\S]*?\)/);
  assert.match(updateBar, /datePending \? \([\s\S]*?skeleton update-bar__date-pending[\s\S]*?\) : \([\s\S]*?<time className="update-bar__date"/);
  // A failed check leaves the cached date visible: it is the only date we have.
  assert.match(updateBar, /\(refreshing \|\| checkingForUpdates\)/);
});

test("the placeholder reserves the width of a date", () => {
  assert.match(layoutCss, /\.update-bar__date-pending \{[\s\S]*?width: 68px/);
  assert.match(layoutCss, /\.update-bar__date-pending \{[\s\S]*?height: 11px/);
});

test("a snapshot that fits is cached and read back", async () => {
  const store = installStorage(4_000_000);
  const cache = await import("../src/api/dataCache.js");
  const publication = validPublication();

  assert.equal(cache.writeCachedPublication(publication), true);
  assert.ok(store.has("umt:publication:v1"));
  const record = cache.readCachedPublication();
  assert.equal(record.data.meta.generated_at, "2026-11-19T15:51:39+00:00");
  assert.ok(record.savedAt);
});

test("an oversized snapshot is refused and the old copy is dropped", async () => {
  const store = installStorage(4_000_000);
  const cache = await import("../src/api/dataCache.js");

  // A smaller, older snapshot is already on disk, as it was for a browser that
  // had not been opened since the payload grew past the origin quota.
  assert.equal(cache.writeCachedPublication(validPublication()), true);
  const stale = store.get("umt:publication:v1");
  assert.ok(stale.includes("2026-11-19T15:51:39+00:00"));

  const oversized = validPublication({
    stocks: [{ ticker: "AAA", padding: "x".repeat(4_200_000) }],
  });
  assert.equal(cache.writeCachedPublication(oversized), false);
  // Keeping the old copy would mean showing its date on every visit forever,
  // because the write can never succeed again.
  assert.equal(store.has("umt:publication:v1"), false);
  assert.equal(cache.readCachedPublication(), null);
});

test("a quota error drops the copy instead of leaving it behind", async () => {
  const store = installStorage(4_000_000);
  const cache = await import("../src/api/dataCache.js");
  assert.equal(cache.writeCachedPublication(validPublication()), true);
  assert.ok(store.has("umt:publication:v1"));

  // Simulate a browser whose quota shrank below what already succeeded.
  globalThis.window.localStorage.setItem = () => {
    const error = new Error("The quota has been exceeded.");
    error.name = "QuotaExceededError";
    throw error;
  };
  assert.equal(cache.writeCachedPublication(validPublication()), false);
  assert.equal(store.has("umt:publication:v1"), false);
});

test("an invalid snapshot is never written", async () => {
  const store = installStorage(4_000_000);
  const cache = await import("../src/api/dataCache.js");
  assert.equal(cache.writeCachedPublication(validPublication({ stocks: [] })), false);
  assert.equal(store.has("umt:publication:v1"), false);
});

test("the provider does not claim a snapshot was cached when it was not", () => {
  const provider = read("../src/api/MarketProvider.jsx");
  assert.match(provider, /setBrowserCachedAt\(writeCachedPublication\(payload\) \? savedAt : null\)/);
});

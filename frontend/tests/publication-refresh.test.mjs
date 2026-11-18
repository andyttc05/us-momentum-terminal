import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isNewerPublication,
  isPublicationStale,
  publicationMatchesManifest,
  validPublication,
  validManifest,
} from "../src/api/publicationStatus.js";
import { waitForPublishedRefresh } from "../src/api/refreshPolling.js";
import refreshWorker from "../worker/index.js";
import {
  claimAutomaticRefresh,
  automaticRefreshClaimed,
  runAutomaticRefresh,
} from "../src/api/autoRefresh.js";

const manifest = {
  schemaVersion: 2,
  publicationVersion: "v2",
  generatedAt: "2026-11-18T22:00:00+00:00",
  asOf: "2026-11-18",
  stockCount: 2,
};
const publication = {
  meta: {
    generated_at: manifest.generatedAt,
    as_of: manifest.asOf,
    connection_status: "connected",
    staticSnapshot: { publicationVersion: manifest.publicationVersion },
  },
  universe: { requested: 2, loaded: 2, partial: false, unavailable: [] },
  stocks: [{ ticker: "AAA" }, { ticker: "BBB" }],
  portfolios: {
    top100: { available: true },
    top20: { available: true },
  },
  backtest: {
    top100: { available: true },
    top20: { available: true },
  },
};

test("fresh manifest leaves an identical cached publication in place", () => {
  assert.equal(validManifest(manifest), true);
  assert.equal(validPublication(publication), true);
  assert.equal(publicationMatchesManifest(publication, manifest), true);
});

test("stale or malformed manifests cannot replace a valid browser snapshot", () => {
  assert.equal(publicationMatchesManifest(publication, { ...manifest, generatedAt: "2026-11-19T22:00:00+00:00" }), false);
  assert.equal(validManifest({ ...manifest, stockCount: 0 }), false);
  assert.equal(validManifest({ ...manifest, asOf: "2026-02-31" }), false);
  const incomplete = {
    ...publication,
    universe: { ...publication.universe, loaded: 1, partial: true, unavailable: ["BBB"] },
  };
  assert.equal(validPublication(incomplete), false);
  assert.equal(publicationMatchesManifest(incomplete, manifest), false);
  assert.equal(publicationMatchesManifest({ ...publication, stocks: [{ ticker: "AAA" }] }, manifest), false);
});

test("browser cache fallback preserves the last valid publication when networking is unavailable", async () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    const cache = await import(`../src/api/dataCache.js?cache-test=${Date.now()}`);
    cache.writeCachedPublication(publication);
    assert.deepEqual(cache.readCachedPublication()?.data, publication);
    cache.writeCachedPublication({ ...publication, stocks: [] });
    assert.deepEqual(cache.readCachedPublication()?.data, publication);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("a newer publication is identified from the collection timestamp", () => {
  assert.equal(isNewerPublication(
    { meta: { generated_at: "2026-11-19T22:00:00+00:00", as_of: "2026-11-19", publication_version: "v2" } },
    publication,
  ), true);
});

test("market data age is explicitly classified without hiding the last good snapshot", () => {
  const now = Date.parse("2026-11-18T22:00:00+00:00");
  assert.equal(isPublicationStale("2026-11-18T20:00:00+00:00", now), false);
  assert.equal(isPublicationStale("2026-11-14T20:00:00+00:00", now), true);
});

test("requested refresh becomes updated only after a new Pages publication is observed", async () => {
  let checks = 0;
  const result = await waitForPublishedRefresh({
    timeoutMs: 30,
    intervalMs: 1,
    sleep: async () => {},
    check: async () => ({ changed: ++checks === 2, payload: publication }),
  });
  assert.equal(result.changed, true);
  assert.equal(checks, 2);
});

test("refresh polling reports a timeout and leaves the prior publication alone", async () => {
  let clock = 0;
  await assert.rejects(
    waitForPublishedRefresh({
      timeoutMs: 3,
      intervalMs: 1,
      now: () => clock,
      sleep: async () => { clock += 1; },
      check: async () => ({ changed: false }),
    }),
    { code: "refresh_timeout" },
  );
});

test("refresh polling does not apply or fail immediately on a transient manifest mismatch", async () => {
  let checks = 0;
  const result = await waitForPublishedRefresh({
    timeoutMs: 5,
    intervalMs: 1,
    now: (() => {
      let clock = 0;
      return () => clock++;
    })(),
    sleep: async () => {},
    check: async () => {
      checks += 1;
      if (checks === 1) {
        const error = new Error("publication does not match manifest");
        error.code = "publication_mismatch";
        throw error;
      }
      return { changed: true, payload: publication };
    },
  });
  assert.equal(result.changed, true);
  assert.equal(checks, 2);
});

test("automatic refresh is claimed once per browser session", () => {
  const values = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    assert.equal(automaticRefreshClaimed(), false);
    assert.equal(claimAutomaticRefresh(), true);
    assert.equal(claimAutomaticRefresh(), false);
    assert.equal(automaticRefreshClaimed(), true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("first-load refresh loads data before obtaining a challenge and requesting a workflow", async () => {
  const values = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    const order = [];
    const result = await runAutomaticRefresh({
      load: async () => { order.push("load"); },
      getChallenge: async () => {
        order.push("challenge");
        return "short-lived-token";
      },
      refresh: async (request) => {
        order.push(`refresh:${request.challengeToken}`);
      },
    });
    assert.equal(result.started, true);
    assert.deepEqual(order, ["load", "challenge", "refresh:short-lived-token"]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("first-load challenge failure records a meaningful fallback without a workflow request", async () => {
  const values = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    const requests = [];
    const verificationError = new Error("Refresh verification failed.");
    const result = await runAutomaticRefresh({
      load: async () => {},
      getChallenge: async () => { throw verificationError; },
      refresh: async (request) => { requests.push(request); },
    });
    assert.equal(result.failed, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].requestError, verificationError);
    assert.equal(requests[0].challengeToken, undefined);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("refresh broker keeps GitHub credentials server-side and locks concurrent requests", () => {
  const workerSource = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  assert.match(workerSource, /TURNSTILE_SECRET_KEY/);
  assert.match(workerSource, /GITHUB_REFRESH_TOKEN/);
  assert.match(workerSource, /REFRESH_COORDINATOR/);
  assert.match(workerSource, /alreadyRunning/);
  assert.match(workerSource, /idFromName/);
  const frontendSources = ["client.js", "MarketProvider.jsx", "refreshChallenge.js"]
    .map((name) => readFileSync(new URL(`../src/api/${name}`, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(frontendSources, /GITHUB_REFRESH_TOKEN|Bearer\s+gh[pousr]_/);
});

test("refresh broker rejects requests outside the configured Pages origin", async () => {
  const response = await refreshWorker.fetch(
    new Request("https://refresh.example.com/api/refresh", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
      body: JSON.stringify({ challengeToken: "token" }),
    }),
    {
      REFRESH_ALLOWED_ORIGINS: "https://andyttc05.github.io",
      REFRESH_COORDINATOR: { idFromName: () => ({ fetch: async () => new Response() }) },
    },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "forbidden",
    message: "Refresh request rejected.",
  });
});

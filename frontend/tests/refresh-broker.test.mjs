import assert from "node:assert/strict";
import test from "node:test";
import refreshWorker, { RefreshCoordinator } from "../worker/index.js";

const ORIGIN = "https://andyttc05.github.io";
const REPOSITORY = "andyttc05/us-momentum-terminal";

function publicationFixture(generatedAt = new Date().toISOString(), overrides = {}) {
  const manifest = {
    schemaVersion: 2,
    publicationVersion: "test-v1",
    generatedAt,
    asOf: generatedAt.slice(0, 10),
    stockCount: 2,
    publicationPath: "data/publication.json",
  };
  const publication = {
    meta: {
      generated_at: generatedAt,
      as_of: manifest.asOf,
      connection_status: "connected",
      publication_version: manifest.publicationVersion,
      staticSnapshot: {
        publicationVersion: manifest.publicationVersion,
        generatedAt,
        asOf: manifest.asOf,
      },
    },
    universe: { requested: 2, loaded: 2, partial: false, unavailable: [] },
    stocks: [{ ticker: "AAA" }, { ticker: "BBB" }],
    portfolios: {
      top100: {
        available: true,
        holdings: Array.from({ length: 100 }, (_, index) => ({ ticker: `T${index}` })),
      },
      top20: {
        available: true,
        holdings: Array.from({ length: 20 }, (_, index) => ({ ticker: `T${index}` })),
      },
    },
    ...overrides,
  };
  return { manifest, publication };
}

function testHarness({ workflowStatus = "queued", conclusion = null, publication } = {}) {
  const values = new Map();
  const calls = [];
  const runs = new Map();
  let runStatus = workflowStatus;
  let runConclusion = conclusion;
  const generatedAt = new Date(Date.now() + 60_000).toISOString();
  let published = publication ?? publicationFixture(generatedAt);

  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value)),
    delete: async (key) => values.delete(key),
  };
  const env = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REF: "main",
    GITHUB_WORKFLOW_FILE: "deploy-pages.yml",
    GITHUB_REFRESH_TOKEN: "server-only-test-token",
    REFRESH_ALLOWED_ORIGINS: ORIGIN,
    REFRESH_ALLOWED_HOSTS: "andyttc05.github.io",
    TURNSTILE_ACTION: "refresh",
    TURNSTILE_SECRET_KEY: "server-only-turnstile-secret",
  };
  let verifier = { success: true, hostname: "andyttc05.github.io", action: "refresh" };
  let coordinator;
  env.REFRESH_COORDINATOR = {
    idFromName: (name) => name,
    get: () => coordinator,
  };
  coordinator = new RefreshCoordinator({ storage }, env);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.includes("challenges.cloudflare.com")) {
      return Response.json(verifier);
    }
    if (url.includes("/dispatches")) {
      return new Response(null, { status: 204 });
    }
    if (url.includes("/actions/workflows/") && url.includes("/runs?")) {
      const run = {
        id: 42,
        status: runStatus,
        conclusion: runConclusion,
        created_at: new Date().toISOString(),
        run_started_at: runStatus === "in_progress" ? new Date().toISOString() : null,
      };
      runs.set(run.id, run);
      return Response.json({ workflow_runs: [run] });
    }
    if (url.includes("/actions/runs/42")) {
      return Response.json({
        id: 42,
        status: runStatus,
        conclusion: runConclusion,
        created_at: new Date().toISOString(),
        run_started_at: runStatus === "in_progress" ? new Date().toISOString() : null,
      });
    }
    if (url.includes("/data/manifest.json")) return Response.json(published.manifest);
    if (url.includes("/data/publication.json")) return Response.json(published.publication);
    return new Response("not found", { status: 404 });
  };

  return {
    calls,
    coordinator,
    env,
    values,
    setRun(status, nextConclusion = null) {
      runStatus = status;
      runConclusion = nextConclusion;
    },
    setPublication(next) {
      published = next;
    },
    setVerifier(next) {
      verifier = next;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function refreshRequest({ origin = ORIGIN, host = "refresh.example.com", token = "valid-token" } = {}) {
  return new Request(`https://${host}/api/refresh`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ challengeToken: token }),
  });
}

async function statusRequest(env, requestId = "") {
  const query = requestId ? `?requestId=${encodeURIComponent(requestId)}` : "";
  return refreshWorker.fetch(new Request(`https://refresh.example.com/api/status${query}`, {
    headers: { Origin: ORIGIN },
  }), env);
}

test("health is public and unknown routes have a controlled JSON 404", async () => {
  const harness = testHarness();
  try {
    const health = await refreshWorker.fetch(
      new Request("https://refresh.example.com/api/health"),
      harness.env,
    );
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.status, "ok");
    assert.equal(body.configured, true);
    assert.doesNotMatch(JSON.stringify(body), /server-only/);

    const missing = await refreshWorker.fetch(
      new Request("https://refresh.example.com/"),
      harness.env,
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "not_found");
    assert.equal(harness.calls.length, 0);
  } finally {
    harness.restore();
  }
});

test("refresh endpoint enforces exact origin, Turnstile action and hostname", async () => {
  const harness = testHarness();
  try {
    const wrongOrigin = await refreshWorker.fetch(refreshRequest({ origin: "https://evil.example" }), harness.env);
    assert.equal(wrongOrigin.status, 403);

    harness.setVerifier({ success: true, hostname: "andyttc05.github.io", action: "other" });
    const wrongAction = await refreshWorker.fetch(refreshRequest(), harness.env);
    assert.equal(wrongAction.status, 401);

    harness.setVerifier({ success: true, hostname: "evil.example", action: "refresh" });
    const wrongHost = await refreshWorker.fetch(refreshRequest(), harness.env);
    assert.equal(wrongHost.status, 401);

    harness.setVerifier({ success: false, hostname: "andyttc05.github.io", action: "refresh" });
    const invalidToken = await refreshWorker.fetch(refreshRequest({ token: "invalid" }), harness.env);
    assert.equal(invalidToken.status, 401);
    assert.equal(harness.calls.filter((call) => call.url.includes("/dispatches")).length, 0);
  } finally {
    harness.restore();
  }
});

test("valid Turnstile dispatches one correlated workflow", async () => {
  const harness = testHarness();
  try {
    const response = await refreshWorker.fetch(refreshRequest(), harness.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.accepted, true);
    assert.equal(body.alreadyRunning, false);
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    const dispatch = harness.calls.find((call) => call.url.includes("/dispatches"));
    assert.match(dispatch.url, /actions\/workflows\/deploy-pages\.yml\/dispatches$/);
    assert.equal(JSON.parse(dispatch.options.body).inputs.refresh_request_id, body.requestId);
  } finally {
    harness.restore();
  }
});

test("concurrent visitors and an existing running workflow are coalesced", async () => {
  const harness = testHarness({ workflowStatus: "in_progress" });
  try {
    const [first, second] = await Promise.all([
      refreshWorker.fetch(refreshRequest(), harness.env),
      refreshWorker.fetch(refreshRequest(), harness.env),
    ]);
    const bodies = await Promise.all([first.json(), second.json()]);
    assert.equal(bodies.filter((body) => body.alreadyRunning === false).length, 1);
    assert.equal(bodies.filter((body) => body.alreadyRunning === true).length, 1);
    assert.equal(harness.calls.filter((call) => call.url.includes("/dispatches")).length, 1);
  } finally {
    harness.restore();
  }
});

test("a failed GitHub dispatch does not reveal API details or leave a live lock", async () => {
  const harness = testHarness();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    if (String(input).includes("/dispatches")) {
      return Response.json({ message: "sensitive upstream detail" }, { status: 403 });
    }
    return originalFetch(input, options);
  };
  try {
    const response = await refreshWorker.fetch(refreshRequest(), harness.env);
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.match(text, /dispatch_failed/);
    assert.doesNotMatch(text, /sensitive|server-only|github_authorization_failed/);
    const state = harness.values.get("refresh");
    assert.equal(state.status, "failed");
    assert.equal(state.errorCode, "github_authorization_failed");
  } finally {
    harness.restore();
  }
});

test("workflow failure and timeout use backoff while preserving the last publication", async () => {
  const harness = testHarness();
  try {
    await refreshWorker.fetch(refreshRequest(), harness.env);
    harness.setRun("completed", "failure");
    const active = harness.values.get("refresh");
    active.lastCheckedAt = 0;
    harness.values.set("refresh", active);

    const failed = await (await statusRequest(harness.env, active.requestId)).json();
    assert.equal(failed.status, "failed");
    assert.match(failed.message, /last valid publication remains live/i);
    assert.ok(Date.parse(failed.retryAt) > Date.now());

    const retry = await refreshWorker.fetch(refreshRequest(), harness.env);
    assert.equal(retry.status, 429);
    assert.equal(harness.calls.filter((call) => call.url.includes("/dispatches")).length, 1);

    active.lastCheckedAt = 0;
    harness.setRun("completed", "timed_out");
    harness.values.set("refresh", { ...active, status: "running", failureBackoffUntil: 0 });
    const timedOut = await (await statusRequest(harness.env, active.requestId)).json();
    assert.equal(timedOut.status, "timed_out");
  } finally {
    harness.restore();
  }
});

test("success is reported only after a matching complete publication is visible", async () => {
  const harness = testHarness();
  try {
    await refreshWorker.fetch(refreshRequest(), harness.env);
    harness.setRun("completed", "success");
    harness.setPublication(publicationFixture("2020-01-01T00:00:00.000Z"));
    let active = harness.values.get("refresh");
    active.lastCheckedAt = 0;
    harness.values.set("refresh", active);

    const pending = await (await statusRequest(harness.env, active.requestId)).json();
    assert.equal(pending.status, "running");
    assert.equal(pending.generatedAt, null);

    harness.setPublication(publicationFixture(new Date(Date.now() + 60_000).toISOString()));
    active = harness.values.get("refresh");
    active.lastCheckedAt = 0;
    harness.values.set("refresh", active);
    const succeeded = await (await statusRequest(harness.env, active.requestId)).json();
    assert.equal(succeeded.status, "succeeded");
    assert.equal(succeeded.publicationVersion, "test-v1");
    assert.equal(succeeded.stockCount, 2);
  } finally {
    harness.restore();
  }
});

test("success cooldown prevents immediate duplicate workflows", async () => {
  const harness = testHarness();
  try {
    await refreshWorker.fetch(refreshRequest(), harness.env);
    const active = harness.values.get("refresh");
    harness.values.set("refresh", {
      ...active,
      status: "succeeded",
      cooldownUntil: Date.now() + 60_000,
      publication: {
        generatedAt: new Date().toISOString(),
        publicationVersion: "test-v1",
        asOf: "2026-11-18",
        stockCount: 2,
      },
    });
    const response = await refreshWorker.fetch(refreshRequest(), harness.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.publicationAvailable, true);
    assert.equal(harness.calls.filter((call) => call.url.includes("/dispatches")).length, 1);
  } finally {
    harness.restore();
  }
});

test("an unknown active run retains its lock while status is unavailable and recovers only after confirmed expiry", async () => {
  const harness = testHarness();
  try {
    const old = Date.now() - 61 * 60 * 1000;
    harness.values.set("refresh", {
      requestId: "existing-request",
      status: "queued",
      message: "Refresh workflow is queued.",
      requestedAt: old,
      updatedAt: old,
      lastCheckedAt: 0,
      run: null,
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      if (String(input).includes("challenges.cloudflare.com")) {
        return Response.json({ success: true, hostname: "andyttc05.github.io", action: "refresh" });
      }
      if (String(input).includes("/actions/")) return new Response(null, { status: 503 });
      return originalFetch(input, options);
    };
    const retained = await refreshWorker.fetch(refreshRequest(), harness.env);
    assert.equal((await retained.json()).alreadyRunning, true);
    assert.equal(harness.values.get("refresh").status, "queued");

    globalThis.fetch = async (input, options) => {
      if (String(input).includes("challenges.cloudflare.com")) {
        return Response.json({ success: true, hostname: "andyttc05.github.io", action: "refresh" });
      }
      if (String(input).includes("/actions/workflows/")) return Response.json({ workflow_runs: [] });
      return originalFetch(input, options);
    };
    const expiredState = harness.values.get("refresh");
    expiredState.lastCheckedAt = 0;
    harness.values.set("refresh", expiredState);
    const recovered = await refreshWorker.fetch(refreshRequest(), harness.env);
    const recoveredBody = await recovered.json();
    assert.equal(recovered.status, 429);
    assert.equal(recoveredBody.status, "timed_out");
    assert.equal(harness.calls.filter((call) => call.url.includes("/dispatches")).length, 0);
  } finally {
    harness.restore();
  }
});

test("status endpoint is idle before requests and exposes no credentials", async () => {
  const harness = testHarness();
  try {
    const response = await statusRequest(harness.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "idle");
    assert.doesNotMatch(JSON.stringify(body), /server-only|test-token|secret/i);
  } finally {
    harness.restore();
  }
});

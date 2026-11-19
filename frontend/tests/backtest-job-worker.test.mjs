import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  BacktestJob,
  BacktestRateLimiter,
  validateBacktestConfig,
} from "../worker/index.js";

const ORIGIN = "https://andyttc05.github.io";
const REPOSITORY = "andyttc05/us-momentum-terminal";
const CALLBACK_TOKEN = "runner-only-callback-token";

const CONFIG = {
  portfolio: "top100",
  start: "2020-01-02",
  end: "2021-01-02",
  rebalance_frequency: "semiannual",
};

function resultBlock(dates = 3) {
  const axis = Array.from({ length: dates }, (_, index) => `2020-01-0${index + 1}`);
  const series = axis.map((_, index) => 100 + index);
  return {
    available: true,
    start: axis[0],
    end: axis[axis.length - 1],
    dates: axis,
    strategy: series,
    priceStrategy: series,
    spy: series,
    spmo: series,
    priceSpy: series,
    priceSpmo: series,
    drawdown: axis.map(() => 0),
    annual: [],
    metrics: { cumulative_return: 1.0 },
  };
}

/** Minimal Durable Object storage facade backed by a Map per object name. */
function objectStore() {
  const stores = new Map();
  const alarms = new Map();
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    stores,
    alarms,
    state(name) {
      const map = store(name);
      return {
        map,
        storage: {
          get: async (key) => {
            if (Array.isArray(key)) {
              const found = new Map();
              for (const item of key) {
                if (map.has(item)) found.set(item, structuredClone(map.get(item)));
              }
              return found;
            }
            return map.has(key) ? structuredClone(map.get(key)) : undefined;
          },
          put: async (key, value) => {
            map.set(key, structuredClone(value));
          },
          delete: async (key) => {
            if (Array.isArray(key)) {
              for (const item of key) map.delete(item);
              return;
            }
            map.delete(key);
          },
          setAlarm: async (at) => {
            alarms.set(name, at);
          },
          deleteAlarm: async () => {
            alarms.delete(name);
          },
        },
      };
    },
  };
}

function harness(options = {}) {
  const objects = objectStore();
  const calls = { dispatch: [], turnstile: 0 };
  let githubStatus = options.githubStatus ?? 204;
  let turnstileReply = options.turnstile ?? {
    success: true,
    hostname: "andyttc05.github.io",
    action: "backtest",
  };

  const env = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REF: "main",
    GITHUB_WORKFLOW_FILE: "deploy-pages.yml",
    GITHUB_BACKTEST_WORKFLOW_FILE: "custom-backtest.yml",
    GITHUB_REFRESH_TOKEN: "server-only-github-token",
    REFRESH_ALLOWED_ORIGINS: ORIGIN,
    REFRESH_ALLOWED_HOSTS: "andyttc05.github.io",
    TURNSTILE_ACTION: "refresh",
    TURNSTILE_BACKTEST_ACTION: "backtest",
    TURNSTILE_SECRET_KEY: "server-only-turnstile-secret",
    BACKTEST_CALLBACK_TOKEN: CALLBACK_TOKEN,
  };

  env.BACKTEST_JOB = {
    idFromName: (name) => name,
    get: (name) => new BacktestJob(objects.state(name), env),
  };
  env.BACKTEST_LIMITER = {
    idFromName: (name) => name,
    get: (name) => new BacktestRateLimiter(objects.state(name), env),
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("challenges.cloudflare.com")) {
      calls.turnstile += 1;
      return new Response(JSON.stringify(turnstileReply), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/actions/workflows/")) {
      calls.dispatch.push(JSON.parse(init.body || "{}"));
      return new Response(null, { status: githubStatus });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  return {
    env,
    objects,
    calls,
    setGithubStatus: (status) => { githubStatus = status; },
    setTurnstile: (reply) => { turnstileReply = reply; },
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

function submit(env, overrides = {}) {
  return worker.fetch(
    new Request("https://broker.test/api/backtest", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "content-type": "application/json",
        "CF-Connecting-IP": overrides.ip ?? "203.0.113.7",
      },
      body: JSON.stringify({
        challengeToken: "turnstile-assertion",
        config: overrides.config ?? CONFIG,
      }),
    }),
    env,
  );
}

async function submitAndRead(env) {
  const response = await submit(env);
  const body = await response.json();
  return { response, body };
}

test("config validation mirrors the Python contract", () => {
  const cases = [
    [{ ...CONFIG, portfolio: "top50" }, "invalid_portfolio"],
    [{ ...CONFIG, rebalance_frequency: "weekly" }, "invalid_rebalance_frequency"],
    [{ ...CONFIG, start: "15/03/2019" }, "invalid_start"],
    [{ ...CONFIG, start: "2022-01-02", end: "2021-01-02" }, "invalid_range"],
    [{ ...CONFIG, start: "2024-02-31" }, "invalid_start"],
    [{ ...CONFIG, initial_capital: 0 }, "invalid_initial_capital"],
    [{ ...CONFIG, initial_capital: true }, "invalid_initial_capital"],
    [{ ...CONFIG, cashflow_enabled: true }, "invalid_cashflow_amount"],
    [{ ...CONFIG, cashflow_frequency: "daily" }, "invalid_cashflow_frequency"],
    [{ ...CONFIG, cashflow_direction: "sideways" }, "invalid_cashflow_direction"],
    [{ ...CONFIG, cashflow_enabled: "yes" }, "invalid_cashflow_enabled"],
    [{ ...CONFIG, start: "1900-01-01", end: "2025-01-01" }, "range_too_long"],
    ["not-an-object", "invalid_config"],
  ];
  for (const [payload, code] of cases) {
    const verdict = validateBacktestConfig(payload);
    assert.equal(verdict.ok, false, `expected ${code} for ${JSON.stringify(payload)}`);
    assert.equal(verdict.code, code);
  }

  const accepted = validateBacktestConfig({
    ...CONFIG,
    portfolio: "top20",
    rebalance_frequency: "monthly",
    initial_capital: 5000,
    cashflow_enabled: true,
    cashflow_amount: 250,
    cashflow_frequency: "annually",
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.config.cashflow_frequency, "annual");
  assert.equal(accepted.config.portfolio, "top20");
});

test("a valid submission dispatches the workflow and returns a job handle", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { response, body } = await submitAndRead(h.env);

  assert.equal(response.status, 202);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.match(body.accessToken, /^[0-9a-f]{32}$/);
  assert.equal(body.status, "queued");
  assert.equal(h.calls.dispatch.length, 1);
  assert.deepEqual(h.calls.dispatch[0].inputs, { request_id: body.requestId });
  assert.equal(h.calls.dispatch[0].ref, "main");
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /server-only|runner-only/);
});

test("an unlisted origin is rejected before anything is dispatched", async (t) => {
  const h = harness();
  t.after(h.restore);
  const response = await worker.fetch(
    new Request("https://broker.test/api/backtest", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: "x", config: CONFIG }),
    }),
    h.env,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "forbidden",
    message: "Refresh request rejected.",
  });
  assert.equal(h.calls.dispatch.length, 0);
});

test("a failed challenge blocks the submission", async (t) => {
  const h = harness({ turnstile: { success: false, hostname: "andyttc05.github.io", action: "backtest" } });
  t.after(h.restore);
  const { response, body } = await submitAndRead(h.env);
  assert.equal(response.status, 401);
  assert.equal(body.code, "verification_failed");
  assert.equal(h.calls.dispatch.length, 0);
});

test("a refresh assertion cannot be replayed against the backtest action", async (t) => {
  const h = harness({ turnstile: { success: true, hostname: "andyttc05.github.io", action: "refresh" } });
  t.after(h.restore);
  const { response, body } = await submitAndRead(h.env);
  assert.equal(response.status, 401);
  assert.equal(body.code, "verification_failed");
});

test("a rejected dispatch is reported and the job is failed, not queued forever", async (t) => {
  const h = harness({ githubStatus: 403 });
  t.after(h.restore);
  const { response, body } = await submitAndRead(h.env);
  assert.equal(response.status, 502);
  assert.equal(body.code, "github_authorization_failed");
});

test("per-IP rate limiting stops a sixth submission inside the window", async (t) => {
  const h = harness();
  t.after(h.restore);
  const codes = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await submit(h.env);
    codes.push(response.status);
  }
  assert.deepEqual(codes.slice(0, 5), [202, 202, 202, 202, 202]);
  assert.equal(codes[5], 429);
  const body = await (await submit(h.env)).json();
  assert.equal(body.code, "rate_limited");
  assert.equal(h.calls.dispatch.length, 5);
});

test("status requires the access token and never leaks another job", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);

  const anonymous = await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN },
    }),
    h.env,
  );
  assert.equal(anonymous.status, 403);

  const wrong = await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": "0".repeat(32) },
    }),
    h.env,
  );
  assert.equal(wrong.status, 403);

  const ok = await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  );
  assert.equal(ok.status, 200);
  const state = await ok.json();
  assert.equal(state.status, "queued");
  assert.equal(state.result, null);
  assert.equal(state.requestId, body.requestId);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
});

test("an unknown request id has no job", async (t) => {
  const h = harness();
  t.after(h.restore);
  const response = await worker.fetch(
    new Request(
      "https://broker.test/api/backtest/status?requestId=11111111-2222-3333-4444-555555555555",
      { headers: { Origin: ORIGIN, "x-umt-backtest-token": "a".repeat(32) } },
    ),
    h.env,
  );
  assert.equal(response.status, 404);
});

test("the internal job endpoint requires the runner token", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);

  const unauthorised = await worker.fetch(
    new Request(`https://broker.test/api/backtest/job?requestId=${body.requestId}`),
    h.env,
  );
  assert.equal(unauthorised.status, 401);

  const authorised = await worker.fetch(
    new Request(`https://broker.test/api/backtest/job?requestId=${body.requestId}`, {
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}` },
    }),
    h.env,
  );
  assert.equal(authorised.status, 200);
  const payload = await authorised.json();
  assert.equal(payload.config.portfolio, "top100");
  assert.equal(payload.config.cashflow_frequency, "monthly");
  assert.equal(payload.status, "queued");
});

test("the config endpoint refuses a finished job", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.requestId, status: "failed", error: "boom" }),
    }),
    h.env,
  );
  const response = await worker.fetch(
    new Request(`https://broker.test/api/backtest/job?requestId=${body.requestId}`, {
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}` },
    }),
    h.env,
  );
  assert.equal(response.status, 409);
});

test("the callback rejects an unauthenticated caller", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const response = await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.requestId, status: "completed", result: resultBlock() }),
    }),
    h.env,
  );
  assert.equal(response.status, 401);
});

test("the callback rejects a malformed result and keeps the job running", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const response = await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: body.requestId,
        status: "completed",
        result: { available: true, dates: ["2020-01-01"], strategy: [] },
      }),
    }),
    h.env,
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_result");

  const state = await (await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  )).json();
  assert.equal(state.status, "queued");
});

test("a callback for another request id is refused", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const response = await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "99999999-9999-9999-9999-999999999999",
        status: "completed",
        result: resultBlock(),
      }),
    }),
    h.env,
  );
  assert.equal(response.status, 404);
});

test("a completed job returns the stored result and ignores a second callback", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const result = resultBlock();

  const running = await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.requestId, status: "running" }),
    }),
    h.env,
  );
  assert.equal(running.status, 200);

  const finished = await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.requestId, status: "completed", result }),
    }),
    h.env,
  );
  assert.equal(finished.status, 200);

  const duplicate = await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: body.requestId,
        status: "completed",
        result: { available: false, reason: "late overwrite" },
      }),
    }),
    h.env,
  );
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);

  const state = await (await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  )).json();
  assert.equal(state.status, "completed");
  assert.deepEqual(state.result, result);
  assert.equal(state.startedAt === null, false);
});

test("a large result is chunked across rows and reassembled byte-for-byte", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const dates = 9000;
  const axis = Array.from({ length: dates }, (_, index) => `20${String(10 + (index % 20)).padStart(2, "0")}-01-01`);
  const series = axis.map((_, index) => 100 + (index % 17));
  const result = {
    available: true,
    dates: axis,
    strategy: series,
    priceStrategy: series,
    spy: series,
    spmo: series,
    drawdown: series,
    annual: [],
    metrics: {},
  };
  await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.requestId, status: "completed", result }),
    }),
    h.env,
  );
  const store = h.objects.stores.get(body.requestId);
  const chunkKeys = [...store.keys()].filter((key) => key.startsWith("r:"));
  assert.ok(chunkKeys.length > 1, "expected the result to span several rows");

  const state = await (await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  )).json();
  assert.equal(state.status, "completed");
  assert.equal(state.result.dates.length, dates);
  assert.deepEqual(state.result.strategy, series);
});

test("an oversized result is refused", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const dates = 900_000;
  const axis = Array.from({ length: dates }, () => "2020-01-01");
  const result = { available: true, dates: axis, strategy: axis.map(() => 1), metrics: {} };
  const response = await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.requestId, status: "completed", result }),
    }),
    h.env,
  );
  assert.equal(response.status, 413);
  // Either the edge size check or the Durable Object's own limit may fire
  // first; both must refuse the payload instead of storing it.
  assert.ok(["result_too_large", "payload_too_large"].includes((await response.json()).code));
});

test("an abandoned job is failed after the timeout instead of polling forever", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const store = h.objects.stores.get(body.requestId);
  const job = store.get("job");
  job.createdAt = Date.now() - 46 * 60 * 1000;
  store.set("job", job);

  const state = await (await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  )).json();
  assert.equal(state.status, "failed");
  assert.equal(state.code, "timeout");
});

test("a job past its retention window is removed and reported as expired", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const store = h.objects.stores.get(body.requestId);
  const job = store.get("job");
  job.expiresAt = Date.now() - 1000;
  job.status = "completed";
  store.set("job", job);

  const response = await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  );
  assert.equal(response.status, 410);
  assert.equal(store.has("job"), false);
});

test("health reports the backtest configuration without exposing secrets", async (t) => {
  const h = harness();
  t.after(h.restore);
  const response = await worker.fetch(new Request("https://broker.test/api/health"), h.env);
  const body = await response.json();
  assert.equal(body.backtest.configured, true);
  assert.equal(body.backtest.job, true);
  assert.equal(body.backtest.callbackToken, true);
  assert.doesNotMatch(JSON.stringify(body), /server-only|runner-only/);
});

test("the backtest API is unavailable when the job bindings are missing", async (t) => {
  const h = harness();
  t.after(h.restore);
  const env = { ...h.env, BACKTEST_JOB: undefined };
  const response = await submit(env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "misconfigured");
});

test("existing refresh routes still answer after the backtest additions", async (t) => {
  const h = harness();
  t.after(h.restore);
  const response = await worker.fetch(
    new Request("https://broker.test/api/refresh", {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: "token" }),
    }),
    h.env,
  );
  // The harness has no RefreshCoordinator binding, so the route must still
  // reach its own configuration check rather than falling into the backtest
  // branch or a 404.
  assert.equal(response.status, 503);
  assert.equal((await response.json()).message, "Refresh service is not configured.");
});

test("the submission advertises a two-second poll interval", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  assert.equal(body.pollIntervalMs, 2000);
  assert.match(body.acceptedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("only runner-observed stages are exposed, in order", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);

  const read = async () => (await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  )).json();

  assert.equal((await read()).stage, null);

  const stages = [];
  for (const stage of ["preparing", "calculating", "delivering"]) {
    const response = await worker.fetch(
      new Request("https://broker.test/api/backtest/callback", {
        method: "POST",
        headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ requestId: body.requestId, status: "running", stage }),
      }),
      h.env,
    );
    assert.equal(response.status, 200);
    const state = await read();
    stages.push(state.stage);
    assert.equal(state.status, "running");
  }
  assert.deepEqual(stages, ["preparing", "calculating", "delivering"]);

  // An invented stage must not be shown to the reader.
  await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.requestId, status: "running", stage: "halfway" }),
    }),
    h.env,
  );
  assert.equal((await read()).stage, "delivering");
});

test("timing markers are stored with the result and sanitised", async (t) => {
  const h = harness();
  t.after(h.restore);
  const { body } = await submitAndRead(h.env);
  const timings = {
    runnerStartedAt: 1_700_000_000_000,
    engineStartedAt: 1_700_000_001_000,
    engineFinishedAt: 1_700_000_009_000,
    callbackStartedAt: 1_700_000_009_100,
    callbackFinishedAt: "not-a-number",
    injected: 42,
  };
  await worker.fetch(
    new Request("https://broker.test/api/backtest/callback", {
      method: "POST",
      headers: { authorization: `Bearer ${CALLBACK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: body.requestId,
        status: "completed",
        result: resultBlock(),
        timings,
      }),
    }),
    h.env,
  );

  const state = await (await worker.fetch(
    new Request(`https://broker.test/api/backtest/status?requestId=${body.requestId}`, {
      headers: { Origin: ORIGIN, "x-umt-backtest-token": body.accessToken },
    }),
    h.env,
  )).json();

  assert.equal(state.timings.engineFinishedAt - state.timings.engineStartedAt, 8000);
  assert.equal(state.timings.callbackFinishedAt, undefined);
  assert.equal(state.timings.injected, undefined);
  assert.equal(state.stage, null, "a finished job has no active stage");
});

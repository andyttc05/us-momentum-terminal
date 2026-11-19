import assert from "node:assert/strict";
import test from "node:test";
import { BacktestJobError, createBacktestJobClient } from "../src/api/backtestJob.js";

const CONFIG = {
  portfolio: "top100",
  start: "2020-01-02",
  end: "2021-01-02",
  rebalance_frequency: "semiannual",
  initial_capital: 10000,
  cashflow_enabled: false,
  cashflow_amount: 0,
  cashflow_frequency: "monthly",
  cashflow_direction: "inflow",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Scripted transport: the first call is the submission, every later call is a
 * status poll that consumes the next scripted state.
 */
function harness({ submit, states = [], clock = { value: 0 } }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers, body: init.body });
    if (url.endsWith("/api/backtest")) {
      if (typeof submit === "function") return submit();
      return submit === undefined
        ? jsonResponse({ requestId: "req-1", accessToken: "token-1", status: "queued" }, 202)
        : submit;
    }
    const next = states.shift();
    if (typeof next === "function") return next();
    if (next instanceof Response) return next;
    if (next instanceof Error) throw next;
    return jsonResponse(next ?? { status: "running" });
  };
  const client = createBacktestJobClient({
    baseUrl: "https://broker.test",
    fetchImpl,
    sleep: async () => {},
    now: () => clock.value,
  });
  return { client, calls, clock };
}

test("a published-only deployment reports the client as disabled", () => {
  const client = createBacktestJobClient({ baseUrl: "", fetchImpl: async () => jsonResponse({}) });
  assert.equal(client.enabled, false);
  return assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x" }),
    (error) => error.code === "backtest_unavailable",
  );
});

test("submitting sends the full configuration and the bot assertion", async () => {
  const { client, calls } = harness({ states: [{ status: "completed", result: { available: true } }] });
  const result = await client.run(CONFIG, { challengeToken: "assertion" });
  assert.deepEqual(result, { available: true });
  const submission = calls[0];
  assert.equal(submission.method, "POST");
  assert.equal(submission.url, "https://broker.test/api/backtest");
  const body = JSON.parse(submission.body);
  assert.equal(body.challengeToken, "assertion");
  assert.equal(body.config.start, "2020-01-02");
  assert.equal(body.config.rebalance_frequency, "semiannual");
});

test("queued and running states are reported before the result arrives", async () => {
  const seen = [];
  const { client } = harness({
    states: [
      { status: "queued", message: "Queued" },
      { status: "running", message: "Running" },
      { status: "completed", result: { available: true, dates: ["2020-01-02"] } },
    ],
  });
  const result = await client.run(CONFIG, {
    challengeToken: "x",
    onStatus: (state) => seen.push(state.status),
  });
  assert.deepEqual(seen, ["queued", "queued", "running", "completed"]);
  assert.equal(result.available, true);
});

test("the status poll authenticates with the access token", async () => {
  const { client, calls } = harness({ states: [{ status: "completed", result: { available: true } }] });
  await client.run(CONFIG, { challengeToken: "x" });
  const poll = calls[1];
  assert.match(poll.url, /requestId=req-1/);
  assert.equal(poll.headers["x-umt-backtest-token"], "token-1");
});

test("a failed job surfaces the engine's own message", async () => {
  const { client } = harness({
    states: [{ status: "failed", error: "Insufficient historical data for 2024-01-02." }],
  });
  await assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x" }),
    (error) => {
      assert.ok(error instanceof BacktestJobError);
      assert.equal(error.code, "engine_failed");
      assert.match(error.message, /Insufficient historical data/);
      return true;
    },
  );
});

test("a rejected submission reports its error code and stays retryable", async () => {
  const { client } = harness({
    submit: jsonResponse({ code: "rate_limited", message: "Too many requests." }, 429),
  });
  await assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x" }),
    (error) => error.code === "rate_limited" && error.status === 429,
  );
});

test("a transient transport error does not abandon a live job", async () => {
  const { client } = harness({
    states: [
      new Error("network down"),
      { status: "completed", result: { available: true } },
    ],
  });
  const result = await client.run(CONFIG, { challengeToken: "x" });
  assert.equal(result.available, true);
});

test("repeated transport errors stop polling instead of spinning forever", async () => {
  const { client, calls } = harness({
    states: [new Error("down"), new Error("down"), new Error("down"), { status: "running" }],
  });
  await assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x" }),
    (error) => error.code === "backtest_status_unavailable",
  );
  assert.equal(calls.length, 4);
});

test("the deadline bounds the wait even while the job keeps reporting running", async () => {
  const clock = { value: 0 };
  const { client, calls } = harness({
    clock,
    states: Array.from({ length: 20 }, () => {
      return () => {
        clock.value += 60_000;
        return jsonResponse({ status: "running" });
      };
    }),
  });
  await assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x" }),
    (error) => error.code === "backtest_timeout",
  );
  assert.ok(calls.length < 20);
});

test("an expired job asks the reader to run it again", async () => {
  const { client } = harness({ states: [jsonResponse({ code: "expired" }, 410)] });
  await assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x" }),
    (error) => error.code === "backtest_expired",
  );
});

test("a superseded run never publishes its result", async () => {
  let active = true;
  const { client } = harness({
    states: [
      () => {
        active = false;
        return jsonResponse({ status: "completed", result: { available: true, stale: true } });
      },
    ],
  });
  await assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x", isActive: () => active }),
    (error) => error.code === "backtest_cancelled",
  );
});

test("a superseded run stops polling at the next tick", async () => {
  let active = true;
  const { client, calls } = harness({
    states: [
      () => {
        active = false;
        return jsonResponse({ status: "running" });
      },
      { status: "completed", result: { available: true } },
    ],
  });
  await assert.rejects(
    () => client.run(CONFIG, { challengeToken: "x", isActive: () => active }),
    (error) => error.code === "backtest_cancelled",
  );
  assert.equal(calls.length, 2);
});

test("status reports are suppressed once the run is superseded", async () => {
  const seen = [];
  let active = true;
  const { client } = harness({
    states: [
      () => {
        active = false;
        return jsonResponse({ status: "running" });
      },
    ],
  });
  await assert.rejects(
    () => client.run(CONFIG, {
      challengeToken: "x",
      isActive: () => active,
      onStatus: (state) => seen.push(state.status),
    }),
    (error) => error.code === "backtest_cancelled",
  );
  assert.deepEqual(seen, ["queued"]);
});

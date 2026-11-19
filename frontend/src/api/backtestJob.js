/**
 * Client for the on-demand custom backtest.
 *
 * A custom date range cannot be answered from the published JSON, so the
 * browser submits it to the Cloudflare broker, which dispatches a GitHub
 * Actions run. This module owns the submit/poll protocol and the rules that
 * keep polling honest: one deadline, a bounded number of consecutive
 * transport errors, and a cancellation hook that stops a superseded run from
 * publishing its result.
 *
 * Transport is injected so the protocol can be tested without a network.
 */

export class BacktestJobError extends Error {
  constructor(message, { code = "backtest_failed", status = 0, retryable = false } = {}) {
    super(message);
    this.name = "BacktestJobError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const TERMINAL = new Set(["completed", "failed"]);

/**
 * Copy for each state the runner can actually confirm.
 *
 * A stage is only shown when the runner reported it, so the page never
 * describes work that is not happening; there is no percentage or ETA because
 * neither can be observed from here. Labels stay two words or fewer: the card
 * sits in a corner of a dense dashboard and should read at a glance.
 */
export const STAGE_COPY = {
  queued: "Queued",
  preparing: "Preparing data",
  calculating: "Running simulation",
  delivering: "Finishing up",
};

export function stageMessage({ status, stage } = {}) {
  if (status === "completed") return "Backtest complete";
  if (status === "failed") return "The backtest could not be completed.";
  if (status === "running") return STAGE_COPY[stage] || STAGE_COPY.preparing;
  return STAGE_COPY.queued;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createBacktestJobClient({
  baseUrl = "",
  fetchImpl = (...args) => fetch(...args),
  sleep = defaultSleep,
  now = () => Date.now(),
  // 2 s: a queued/running job changes state within a few seconds of the runner
  // reaching a checkpoint, and a job costs ~20-60 polls at this rate.
  pollIntervalMs = 2000,
  timeoutMs = 10 * 60 * 1000,
  maxConsecutiveErrors = 3,
} = {}) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const enabled = Boolean(base);

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function submit(config, { challengeToken, signal } = {}) {
    if (!enabled) {
      throw new BacktestJobError(
        "Custom-date backtests are not configured for this deployment.",
        { code: "backtest_unavailable" },
      );
    }
    let response;
    try {
      response = await fetchImpl(`${base}/api/backtest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        // A short-lived bot assertion, never a credential.
        body: JSON.stringify({ challengeToken, config }),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new BacktestJobError("Cannot reach the backtest service.", {
        code: "backtest_offline",
        retryable: true,
      });
    }
    const body = await readJson(response);
    if (!response.ok) {
      throw new BacktestJobError(
        body?.message || "The backtest request was not accepted.",
        { code: body?.code || "backtest_rejected", status: response.status, retryable: response.status >= 500 },
      );
    }
    if (!body?.requestId || !body?.accessToken) {
      throw new BacktestJobError("The backtest service returned an incomplete job.", {
        code: "backtest_invalid_response",
        status: response.status,
      });
    }
    return {
      requestId: body.requestId,
      accessToken: body.accessToken,
      status: body.status || "queued",
      acceptedAt: typeof body.acceptedAt === "string" ? body.acceptedAt : null,
      pollIntervalMs: Number(body.pollIntervalMs) || pollIntervalMs,
    };
  }

  async function poll(requestId, accessToken, { signal } = {}) {
    const response = await fetchImpl(
      `${base}/api/backtest/status?requestId=${encodeURIComponent(requestId)}`,
      {
        headers: { Accept: "application/json", "x-umt-backtest-token": accessToken },
        cache: "no-store",
        signal,
      },
    );
    const body = await readJson(response);
    if (response.status === 410) {
      throw new BacktestJobError(
        "This backtest result has expired. Run it again to recalculate.",
        { code: "backtest_expired", status: 410 },
      );
    }
    if (response.status === 403 || response.status === 404) {
      throw new BacktestJobError("This backtest result is no longer available.", {
        code: body?.code || "backtest_missing",
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new BacktestJobError(body?.message || "The backtest status is unavailable.", {
        code: body?.code || "backtest_status_failed",
        status: response.status,
        retryable: true,
      });
    }
    return body;
  }

  /**
   * Submit a job and resolve with the finished block.
   *
   * ``isActive`` is consulted before every state change and before the result
   * is returned, so a newer run (or an unmounted page) can never be overwritten
   * by the job it replaced.
   */
  async function run(config, { challengeToken, onStatus, signal, isActive } = {}) {
    const active = typeof isActive === "function" ? isActive : () => true;
    const deadline = now() + timeoutMs;
    const job = await submit(config, { challengeToken, signal });
    if (!active()) {
      throw new BacktestJobError("The backtest was superseded.", { code: "backtest_cancelled" });
    }
    const report = (state) => {
      if (active() && typeof onStatus === "function") onStatus(state);
    };
    report({
      status: job.status,
      stage: null,
      requestId: job.requestId,
      createdAt: job.acceptedAt || null,
      message: stageMessage({ status: job.status }),
    });

    let interval = job.pollIntervalMs;
    let consecutiveErrors = 0;
    while (now() < deadline) {
      await sleep(interval);
      if (!active()) {
        throw new BacktestJobError("The backtest was superseded.", { code: "backtest_cancelled" });
      }
      let state;
      try {
        state = await poll(job.requestId, job.accessToken, { signal });
        consecutiveErrors = 0;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (error instanceof BacktestJobError && !error.retryable) throw error;
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new BacktestJobError(
            "The backtest service stopped responding. Try again.",
            { code: "backtest_status_unavailable", retryable: true },
          );
        }
        continue;
      }

      if (state.status === "completed") {
        if (!active()) {
          throw new BacktestJobError("The backtest was superseded.", { code: "backtest_cancelled" });
        }
        report({
          status: "completed",
          stage: null,
          requestId: job.requestId,
          startedAt: state.startedAt || null,
          completedAt: state.completedAt || null,
          timings: state.timings || null,
          message: stageMessage({ status: "completed" }),
        });
        return state.result;
      }
      if (state.status === "failed") {
        throw new BacktestJobError(
          state.error || "The backtest could not be completed.",
          { code: state.code || "engine_failed", retryable: true },
        );
      }
      report({
        status: state.status,
        stage: state.stage || null,
        requestId: job.requestId,
        createdAt: state.createdAt || job.acceptedAt || null,
        startedAt: state.startedAt || null,
        message: stageMessage(state),
      });
    }

    throw new BacktestJobError(
      "The backtest is taking longer than expected. Try again in a moment.",
      { code: "backtest_timeout", retryable: true },
    );
  }

  return { enabled, run, submit, poll };
}

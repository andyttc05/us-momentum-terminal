const UNKNOWN_RUN_GRACE_MS = 60 * 60 * 1000;
const PUBLICATION_GRACE_MS = 10 * 60 * 1000;
const SUCCESS_COOLDOWN_MS = 15 * 60 * 1000;
const FAILURE_BACKOFF_MS = 15 * 60 * 1000;
const STATUS_CHECK_INTERVAL_MS = 5 * 1000;
const RUN_DISCOVERY_WINDOW_MS = 10 * 60 * 1000;
const PUBLICATION_CLOCK_TOLERANCE_MS = 10 * 1000;

function corsHeaders(origin, methods = "GET, POST, OPTIONS") {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "content-type, accept, x-umt-backtest-token",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function json(body, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

function errorResponse(code, message, status, origin = "") {
  return json({ code, message }, status, origin);
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return origin && list(env.REFRESH_ALLOWED_ORIGINS).includes(origin) ? origin : "";
}

async function readChallengeToken(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 16_384) return "";
  const text = await request.text();
  if (text.length > 16_384) return "";
  try {
    const body = JSON.parse(text);
    return typeof body?.challengeToken === "string" ? body.challengeToken : "";
  } catch {
    return "";
  }
}

async function verifyTurnstileFor(request, challengeToken, env, expectedAction) {
  if (!challengeToken || !env.TURNSTILE_SECRET_KEY) {
    return { ok: false, code: "verification_unavailable" };
  }
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", challengeToken);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);

  let response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
  } catch {
    return { ok: false, code: "verification_unavailable" };
  }
  const result = await response.json().catch(() => ({}));
  if (response.ok !== true || result?.success !== true) {
    return { ok: false, code: "verification_failed" };
  }
  const expectedHosts = list(env.REFRESH_ALLOWED_HOSTS);
  if (!expectedHosts.length || !expectedHosts.includes(result.hostname)) {
    return { ok: false, code: "verification_failed" };
  }
  // Each public action has its own widget action, so a token minted for the
  // market refresh cannot be replayed against the backtest endpoint.
  if (result.action !== expectedAction) {
    return { ok: false, code: "verification_failed" };
  }
  return { ok: true };
}

async function verifyTurnstile(request, challengeToken, env) {
  return verifyTurnstileFor(request, challengeToken, env, env.TURNSTILE_ACTION || "refresh");
}

function manifestUrl(env) {
  if (env.PUBLIC_MANIFEST_URL) return env.PUBLIC_MANIFEST_URL;
  const [owner, repository] = String(env.GITHUB_REPOSITORY || "").split("/");
  if (!owner || !repository) return "";
  return `https://${owner}.github.io/${repository}/data/manifest.json`;
}

/**
 * Resolve a published path against the site root.
 *
 * The manifest lives at `<site>/data/manifest.json`, but its `publicationPath`
 * is published relative to the site root (`data/publication.json`). Resolving
 * that path against the manifest directory doubled the `data` segment and
 * requested `/data/data/publication.json`, which always returned 404. The
 * broker then never observed the publication it had just deployed.
 */
export function resolvePublishedUrl(manifestUrlValue, publishedPath) {
  const base = new URL(manifestUrlValue);
  const directory = base.pathname.replace(/[^/]*$/, "");
  const root = directory.replace(/\/data\/$/, "/");
  const path = String(publishedPath || "data/publication.json").replace(/^\/+/, "");
  return new URL(path, new URL(root, base.origin)).toString();
}

function githubHeaders(env) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${env.GITHUB_REFRESH_TOKEN}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "us-momentum-refresh-broker",
  };
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validManifest(manifest) {
  return Boolean(
    manifest
    && Number.isInteger(manifest.schemaVersion)
    && manifest.schemaVersion >= 2
    && typeof manifest.publicationVersion === "string"
    && manifest.publicationVersion
    && validTimestamp(manifest.generatedAt)
    && /^\d{4}-\d{2}-\d{2}$/.test(String(manifest.asOf || ""))
    && Number.isInteger(manifest.stockCount)
    && manifest.stockCount > 0,
  );
}

function validPublication(payload, manifest) {
  const meta = payload?.meta || {};
  const snapshot = meta.staticSnapshot || {};
  const stocks = payload?.stocks;
  const portfolios = payload?.portfolios || {};
  const universe = payload?.universe || {};
  if (!validManifest(manifest) || !Array.isArray(stocks) || stocks.length !== manifest.stockCount) {
    return false;
  }
  if (meta.connection_status !== "connected") return false;
  if (universe.partial !== false || universe.loaded !== universe.requested) return false;
  if (Array.isArray(universe.unavailable) && universe.unavailable.length) return false;
  if ((snapshot.publicationVersion ?? meta.publication_version) !== manifest.publicationVersion) return false;
  if ((snapshot.generatedAt ?? meta.generated_at) !== manifest.generatedAt) return false;
  if ((snapshot.asOf ?? meta.as_of) !== manifest.asOf) return false;
  return ["top100", "top20"].every((portfolio) => {
    const book = portfolios[portfolio];
    const expected = portfolio === "top100" ? 100 : 20;
    return book?.available === true
      && Array.isArray(book.holdings)
      && book.holdings.length === expected;
  });
}

async function publishedPublication(env, requestedAt) {
  const url = manifestUrl(env);
  if (!url) return { available: false, reason: "publication_not_configured" };
  const separator = url.includes("?") ? "&" : "?";
  try {
    const manifestResponse = await fetch(`${url}${separator}refresh=${Date.now()}`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!manifestResponse.ok) return { available: false, reason: "manifest_unavailable" };
    const manifest = await manifestResponse.json();
    if (!validManifest(manifest)) return { available: false, reason: "invalid_manifest" };
    const generatedAt = Date.parse(manifest.generatedAt);
    const requested = typeof requestedAt === "number" ? requestedAt : Date.parse(requestedAt);
    if (!Number.isFinite(requested) || generatedAt < requested - PUBLICATION_CLOCK_TOLERANCE_MS) {
      return { available: false, reason: "awaiting_new_publication" };
    }

    const publicationPath = manifest.publicationPath || "data/publication.json";
    const publicationResponse = await fetch(
      resolvePublishedUrl(url, publicationPath),
      {
        headers: { accept: "application/json", "cache-control": "no-cache" },
        cf: { cacheTtl: 0, cacheEverything: false },
      },
    );
    if (!publicationResponse.ok) return { available: false, reason: "publication_unavailable" };
    const publication = await publicationResponse.json();
    if (!validPublication(publication, manifest)) return { available: false, reason: "invalid_publication" };
    return {
      available: true,
      generatedAt: manifest.generatedAt,
      publicationVersion: manifest.publicationVersion,
      asOf: manifest.asOf,
      stockCount: manifest.stockCount,
    };
  } catch {
    return { available: false, reason: "publication_unavailable" };
  }
}

function publicStatus(state) {
  if (!state) {
    return {
      requestId: null,
      status: "idle",
      message: "No refresh has been requested.",
    };
  }
  const status = ["queued", "running", "succeeded", "failed", "timed_out"].includes(state.status)
    ? state.status
    : "running";
  return {
    requestId: state.requestId || null,
    status,
    message: state.message || "Refresh status is unavailable.",
    requestedAt: state.requestedAt ? new Date(state.requestedAt).toISOString() : null,
    updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
    workflowRunId: state.run?.id ?? null,
    generatedAt: state.publication?.generatedAt ?? null,
    publicationVersion: state.publication?.publicationVersion ?? null,
    asOf: state.publication?.asOf ?? null,
    stockCount: state.publication?.stockCount ?? null,
    // Why the last publication check did not confirm the new snapshot. This is
    // a schema reason code only; it never includes URLs, headers or tokens.
    publicationCheck: state.publicationReason || null,
    retryAt: state.failureBackoffUntil
      ? new Date(state.failureBackoffUntil).toISOString()
      : null,
  };
}

export class RefreshCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // The check, dispatch and state write form one serialized critical section.
    this.operation = Promise.resolve();
  }

  async serialized(task) {
    let release;
    const previous = this.operation;
    this.operation = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  async getRun() {
    const active = await this.state.storage.get("refresh");
    if (!active?.run?.id) return active;
    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/actions/runs/${active.run.id}`,
        { headers: githubHeaders(this.env) },
      );
      if (!response.ok) {
        active.lastCheckError = "run_status_unavailable";
        active.lastCheckedAt = Date.now();
        await this.state.storage.put("refresh", active);
        return active;
      }
      const run = await response.json();
      active.run = {
        id: run.id,
        status: run.status,
        conclusion: run.conclusion || null,
        createdAt: run.created_at || active.run.createdAt || null,
        startedAt: run.run_started_at || active.run.startedAt || null,
      };
      active.lastCheckError = null;
      active.lastCheckedAt = Date.now();
      return active;
    } catch {
      active.lastCheckError = "run_status_unavailable";
      active.lastCheckedAt = Date.now();
      await this.state.storage.put("refresh", active);
      return active;
    }
  }

  async findRun(since) {
    const endpoint = new URL(
      `https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/actions/workflows/${encodeURIComponent(
        this.env.GITHUB_WORKFLOW_FILE || "deploy-pages.yml",
      )}/runs`,
    );
    endpoint.searchParams.set("event", "workflow_dispatch");
    endpoint.searchParams.set("branch", this.env.GITHUB_REF || "main");
    endpoint.searchParams.set("per_page", "20");
    try {
      const response = await fetch(endpoint, { headers: githubHeaders(this.env) });
      if (!response.ok) return { run: null, available: false };
      const body = await response.json();
      const threshold = since - PUBLICATION_CLOCK_TOLERANCE_MS;
      const candidates = (body.workflow_runs || [])
        .filter((run) => Number.isFinite(Date.parse(run.created_at)) && Date.parse(run.created_at) >= threshold)
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
      const run = candidates[0];
      return {
        run: run ? {
          id: run.id,
          status: run.status,
          conclusion: run.conclusion || null,
          createdAt: run.created_at,
          startedAt: run.run_started_at || null,
        } : null,
        available: true,
      };
    } catch {
      return { run: null, available: false };
    }
  }

  async completeFailure(active, status, message, code) {
    const now = Date.now();
    active.status = status;
    active.message = message;
    active.errorCode = code;
    active.completedAt = active.completedAt || now;
    active.failureBackoffUntil = now + FAILURE_BACKOFF_MS;
    active.updatedAt = now;
    await this.state.storage.put("refresh", active);
    return active;
  }

  async reconcile(active, now = Date.now()) {
    if (!active) return null;
    if (["succeeded", "failed", "timed_out"].includes(active.status)) {
      if (active.status === "succeeded" && active.cooldownUntil <= now) {
        await this.state.storage.delete("refresh");
        return null;
      }
      if (active.status !== "succeeded" && active.failureBackoffUntil <= now) {
        await this.state.storage.delete("refresh");
        return null;
      }
      return active;
    }

    if (active.lastCheckedAt && now - active.lastCheckedAt < STATUS_CHECK_INTERVAL_MS) return active;

    if (!active.run?.id) {
      const elapsed = now - active.requestedAt;
      if (elapsed < UNKNOWN_RUN_GRACE_MS) {
        const discovery = await this.findRun(active.requestedAt);
        if (discovery.run) {
          active.run = discovery.run;
          active.message = discovery.run.status === "in_progress"
            ? "Market data collection is running."
            : "Refresh workflow is queued.";
        } else if (elapsed >= RUN_DISCOVERY_WINDOW_MS && discovery.available) {
          return this.completeFailure(
            active,
            "timed_out",
            "The refresh workflow did not start before the dispatch window expired.",
            "dispatch_timeout",
          );
        }
        active.updatedAt = now;
        active.lastCheckedAt = now;
        await this.state.storage.put("refresh", active);
        return active;
      }
      // A missing run id after the allowed workflow window must not release the
      // lock while GitHub is unavailable. Keeping the marker avoids duplicate
      // scrapers; it is cleared when GitHub confirms there is no active run.
      const discovery = await this.findRun(active.requestedAt);
      if (!discovery.available) {
        active.message = "Workflow status is temporarily unavailable.";
        active.updatedAt = now;
        active.lastCheckedAt = now;
        await this.state.storage.put("refresh", active);
        return active;
      }
      if (active.run?.id) return active;
      return this.completeFailure(
        active,
        "timed_out",
        "No refresh workflow was found after the allowed dispatch window.",
        "workflow_not_found",
      );
    }

    active = await this.getRun();
    if (!active.run) return active;
    const runStatus = active.run.status;
    const conclusion = active.run.conclusion;
    if (["queued", "requested", "waiting", "pending"].includes(runStatus)) {
      active.status = "queued";
      active.message = "Refresh workflow is queued.";
      active.updatedAt = now;
    } else if (runStatus === "in_progress") {
      active.status = "running";
      active.message = "Market data collection and validation are running.";
      active.updatedAt = now;
    } else if (runStatus === "completed") {
      if (["failure", "cancelled", "action_required", "startup_failure", "stale"].includes(conclusion)) {
        return this.completeFailure(
          active,
          "failed",
          "The refresh workflow failed. The last valid publication remains live.",
          "workflow_failed",
        );
      }
      if (conclusion === "timed_out") {
        return this.completeFailure(
          active,
          "timed_out",
          "The refresh workflow timed out. The last valid publication remains live.",
          "workflow_timed_out",
        );
      }
      if (conclusion === "success") {
        const publication = await publishedPublication(this.env, active.requestedAt);
        active.publicationReason = publication.available ? null : publication.reason || "unavailable";
        if (publication.available) {
          active.status = "succeeded";
          active.message = "A new validated publication is live.";
          active.publication = publication;
          active.completedAt = now;
          active.cooldownUntil = now + SUCCESS_COOLDOWN_MS;
          active.updatedAt = now;
          await this.state.storage.put("refresh", active);
          return active;
        }
        active.successObservedAt = active.successObservedAt || now;
        if (now - active.successObservedAt >= PUBLICATION_GRACE_MS) {
          return this.completeFailure(
            active,
            "failed",
            "The workflow completed but no new valid publication was visible.",
            "publication_not_visible",
          );
        }
        active.status = "running";
        active.message = "The workflow completed; waiting for the validated publication to appear.";
        active.updatedAt = now;
      }
    }
    await this.state.storage.put("refresh", active);
    return active;
  }

  async dispatch() {
    const now = Date.now();
    let active = await this.reconcile(await this.state.storage.get("refresh"), now);
    if (active && ["queued", "running"].includes(active.status)) {
      return json({
        accepted: true,
        alreadyRunning: true,
        requestId: active.requestId,
        status: active.status,
      });
    }
    if (active?.status === "succeeded" && now < active.cooldownUntil) {
      return json({
        accepted: true,
        alreadyRunning: false,
        publicationAvailable: true,
        requestId: active.requestId,
        status: "succeeded",
      });
    }
    if (active && ["failed", "timed_out"].includes(active.status) && now < active.failureBackoffUntil) {
      return json({
        code: "refresh_backoff",
        message: "A recent refresh failed. The last valid publication remains available.",
        status: active.status,
        retryAt: new Date(active.failureBackoffUntil).toISOString(),
      }, 429);
    }

    if (!this.env.GITHUB_REFRESH_TOKEN || !this.env.GITHUB_REPOSITORY) {
      return errorResponse("misconfigured", "Refresh service is not configured.", 503);
    }

    const requestId = crypto.randomUUID();
    active = {
      requestId,
      status: "queued",
      message: "Sending the refresh request to GitHub Actions.",
      requestedAt: now,
      updatedAt: now,
      workflow: this.env.GITHUB_WORKFLOW_FILE || "deploy-pages.yml",
      run: null,
    };
    await this.state.storage.put("refresh", active);

    const workflow = encodeURIComponent(this.env.GITHUB_WORKFLOW_FILE || "deploy-pages.yml");
    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/actions/workflows/${workflow}/dispatches`,
        {
          method: "POST",
          headers: {
            ...githubHeaders(this.env),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ref: this.env.GITHUB_REF || "main",
            inputs: {
              refresh_reason: "visitor-request",
              refresh_request_id: requestId,
            },
          }),
        },
      );
      if (!response.ok) {
        await this.completeFailure(
          active,
          "failed",
          "The refresh workflow could not be started. The last valid publication remains live.",
          response.status === 401 || response.status === 403
            ? "github_authorization_failed"
            : "dispatch_failed",
        );
        return errorResponse(
          "dispatch_failed",
          "The refresh request could not be started.",
          502,
        );
      }
    } catch {
      await this.completeFailure(
        active,
        "failed",
        "The refresh workflow could not be reached. The last valid publication remains live.",
        "dispatch_unavailable",
      );
      return errorResponse("dispatch_failed", "The refresh request could not be reached.", 503);
    }

    const discovery = await this.findRun(now);
    if (discovery.run) {
      active.run = discovery.run;
      active.status = discovery.run.status === "in_progress" ? "running" : "queued";
      active.message = active.status === "running"
        ? "Market data collection and validation are running."
        : "Refresh workflow is queued.";
    }
    active.updatedAt = Date.now();
    active.lastCheckedAt = Date.now();
    await this.state.storage.put("refresh", active);
    return json({
      accepted: true,
      alreadyRunning: false,
      requestId,
      status: active.status,
    });
  }

  async currentStatus(requestedId = "") {
    const active = await this.reconcile(await this.state.storage.get("refresh"));
    if (requestedId && active?.requestId !== requestedId) {
      return json(publicStatus(null));
    }
    return json(publicStatus(active));
  }

  async fetch(request) {
    const url = new URL(typeof request === "string" ? request : request.url);
    return this.serialized(() => (
      url.pathname === "/status"
        ? this.currentStatus(url.searchParams.get("requestId") || "")
        : this.dispatch()
    ));
  }
}

// --------------------------------------------------------------------------- //
// On-demand custom backtest
//
// A custom-date run costs real CPU, so it is not executed here: the Worker
// validates the request, stores it in a Durable Object and dispatches a GitHub
// Actions workflow. The runner posts the finished block back through an
// authenticated callback. Every write that decides a job's terminal state is
// made inside a single Durable Object, so duplicate or out-of-order callbacks
// can never overwrite a completed result.
// --------------------------------------------------------------------------- //

const ROUTES = [
  "/api/health",
  "/api/refresh",
  "/api/status",
  "/api/backtest",
  "/api/backtest/status",
  "/api/backtest/job",
  "/api/backtest/callback",
];

export const PORTFOLIOS = ["top100", "top20"];
export const REBALANCE_FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual"];
const CASHFLOW_FREQUENCIES = ["monthly", "quarterly", "annual", "annually"];
const CASHFLOW_DIRECTIONS = ["inflow", "outflow"];

// Cloudflare SQLite Durable Objects cap a stored value at 8 MB (key and value
// combined). A result is split so a large payload can never approach that
// ceiling and so the stored shape stays uniform.
const RESULT_CHUNK_CHARS = 200_000;
const MAX_RESULT_BYTES = 6_000_000;
const MAX_CONFIG_CHARS = 8_192;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const JOB_TIMEOUT_MS = 45 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_SUBMISSIONS = 5;
const HOURLY_MAX_DISPATCHES = 20;
const MAX_TRACKED_IPS = 400;
// Stages the runner reports from real execution points. There is no synthetic
// progress: the page only ever shows one of these.
export const RUNNER_STAGES = ["preparing", "calculating", "delivering"];
const STAGE_MESSAGES = {
  preparing: "Preparing historical market data.",
  calculating: "Running the historical simulation.",
  delivering: "Validating and returning results.",
};
// Timing markers the runner measures itself, in epoch milliseconds.
const TIMING_FIELDS = [
  "runnerStartedAt",
  "configFetchedAt",
  "engineStartedAt",
  "engineFinishedAt",
  "callbackStartedAt",
  "callbackFinishedAt",
];
const MAX_CAPITAL = 1_000_000_000;
const MAX_CASHFLOW_AMOUNT = 1_000_000_000;
const MAX_SPAN_DAYS = 40 * 366;

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isoDateValue(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return "";
  // Reject values such as 2024-02-31 that Date.parse would roll forward.
  return new Date(parsed).toISOString().slice(0, 10) === text ? text : "";
}

function numericValue(value, fallback) {
  if (value === undefined || value === null || value === "") return { ok: true, value: fallback };
  if (typeof value === "boolean") return { ok: false };
  if (typeof value !== "number" && typeof value !== "string") return { ok: false };
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

/**
 * The request contract shared with ``data-service/app/backtest_job.py``.
 *
 * Both implementations must accept and reject exactly the same payloads; the
 * Python suite and this module's tests run the same case table.
 */
export function validateBacktestConfig(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "invalid_config", message: "config must be an object" };
  }
  const portfolio = String(payload.portfolio ?? "top100").trim().toLowerCase();
  if (!PORTFOLIOS.includes(portfolio)) {
    return { ok: false, code: "invalid_portfolio", message: "portfolio must be top100 or top20" };
  }
  const frequency = String(payload.rebalance_frequency ?? "semiannual").trim().toLowerCase();
  if (!REBALANCE_FREQUENCIES.includes(frequency)) {
    return {
      ok: false,
      code: "invalid_rebalance_frequency",
      message: `rebalance_frequency must be one of: ${REBALANCE_FREQUENCIES.join(", ")}`,
    };
  }
  const start = isoDateValue(payload.start);
  if (!start) return { ok: false, code: "invalid_start", message: "start must use YYYY-MM-DD" };
  const end = isoDateValue(payload.end);
  if (!end) return { ok: false, code: "invalid_end", message: "end must use YYYY-MM-DD" };
  if (start >= end) return { ok: false, code: "invalid_range", message: "end must be after start" };
  const spanDays = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  if (spanDays > MAX_SPAN_DAYS) {
    return { ok: false, code: "range_too_long", message: "the window is longer than the supported history" };
  }

  const capital = numericValue(payload.initial_capital, 10_000);
  if (!capital.ok || capital.value <= 0 || capital.value > MAX_CAPITAL) {
    return {
      ok: false,
      code: "invalid_initial_capital",
      message: "initial_capital must be greater than zero",
    };
  }

  const cashflowEnabled = payload.cashflow_enabled ?? false;
  if (typeof cashflowEnabled !== "boolean") {
    return { ok: false, code: "invalid_cashflow_enabled", message: "cashflow_enabled must be a boolean" };
  }
  const cashflowAmount = numericValue(payload.cashflow_amount, 0);
  if (!cashflowAmount.ok || cashflowAmount.value < 0 || cashflowAmount.value > MAX_CASHFLOW_AMOUNT) {
    return {
      ok: false,
      code: "invalid_cashflow_amount",
      message: "cashflow_amount must be finite and non-negative",
    };
  }
  if (cashflowEnabled && cashflowAmount.value <= 0) {
    return {
      ok: false,
      code: "invalid_cashflow_amount",
      message: "cashflow_amount must be greater than zero when cashflows are enabled",
    };
  }
  const rawCashflowFrequency = String(payload.cashflow_frequency || "monthly").trim().toLowerCase();
  if (!CASHFLOW_FREQUENCIES.includes(rawCashflowFrequency)) {
    return {
      ok: false,
      code: "invalid_cashflow_frequency",
      message: `unsupported cashflow frequency: ${payload.cashflow_frequency}`,
    };
  }
  const cashflowDirection = String(payload.cashflow_direction ?? "inflow").trim().toLowerCase();
  if (!CASHFLOW_DIRECTIONS.includes(cashflowDirection)) {
    return {
      ok: false,
      code: "invalid_cashflow_direction",
      message: "cashflow_direction must be inflow or outflow",
    };
  }

  return {
    ok: true,
    config: {
      portfolio,
      rebalance_frequency: frequency,
      start,
      end,
      initial_capital: capital.value,
      cashflow_enabled: cashflowEnabled,
      cashflow_amount: cashflowAmount.value,
      cashflow_frequency: rawCashflowFrequency === "annually" ? "annual" : rawCashflowFrequency,
      cashflow_direction: cashflowDirection,
    },
  };
}

function sanitizedTimings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kept = {};
  for (const field of TIMING_FIELDS) {
    const number = Number(value[field]);
    if (Number.isFinite(number) && number > 0) kept[field] = Math.round(number);
  }
  return Object.keys(kept).length ? kept : null;
}

function resultProblem(result) {  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return "result must be an object";
  }
  if (result.available !== true) {
    return typeof result.reason === "string" && result.reason.trim()
      ? ""
      : "an unavailable result must include a reason";
  }
  if (!Array.isArray(result.dates) || !Array.isArray(result.strategy) || !result.dates.length) {
    return "result is missing its date or strategy series";
  }
  if (result.dates.length !== result.strategy.length) {
    return "date and strategy lengths differ";
  }
  for (const key of ["drawdown", "spy", "spmo"]) {
    const series = result[key];
    if (Array.isArray(series) && series.length && series.length !== result.dates.length) {
      return `${key} does not align with the date axis`;
    }
  }
  if (!result.metrics || typeof result.metrics !== "object") {
    return "result is missing its metrics block";
  }
  return "";
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ipFingerprint(request) {
  // Only a fingerprint is stored, never the address itself.
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function serializedRunner(owner) {
  return async function serialized(task) {
    let release;
    const previous = owner.operation;
    owner.operation = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/**
 * Admission control for public submissions.
 *
 * One instance holds every counter, which keeps the check atomic. Volume is
 * far below the free-tier request allowance, so a single serialisation point is
 * cheaper than a correctness bug in a sharded counter.
 */
export class BacktestRateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.operation = Promise.resolve();
    this.serialized = serializedRunner(this);
  }

  async reserve(ipHash, now = Date.now()) {
    const record = (await this.state.storage.get("limits")) || { ips: {}, hour: null };
    const ips = record.ips && typeof record.ips === "object" ? record.ips : {};
    const windowStart = now - RATE_WINDOW_MS;
    const recent = (Array.isArray(ips[ipHash]) ? ips[ipHash] : []).filter((stamp) => stamp > windowStart);

    if (recent.length >= RATE_MAX_SUBMISSIONS) {
      ips[ipHash] = recent;
      await this.state.storage.put("limits", { ips, hour: record.hour ?? null });
      return {
        allowed: false,
        code: "rate_limited",
        message: "Too many backtest requests from this connection. Try again shortly.",
        retryAt: recent[0] + RATE_WINDOW_MS,
      };
    }

    const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
    const hour = record.hour && record.hour.start === hourStart
      ? { start: hourStart, count: Number(record.hour.count) || 0 }
      : { start: hourStart, count: 0 };
    if (hour.count >= HOURLY_MAX_DISPATCHES) {
      return {
        allowed: false,
        code: "capacity",
        message: "The backtest runner is at capacity. Try again later.",
        retryAt: hourStart + 3_600_000,
      };
    }

    hour.count += 1;
    recent.push(now);
    ips[ipHash] = recent;
    if (Object.keys(ips).length > MAX_TRACKED_IPS) {
      for (const key of Object.keys(ips)) {
        const stamps = Array.isArray(ips[key]) ? ips[key] : [];
        if (!stamps.some((stamp) => stamp > windowStart)) delete ips[key];
      }
    }
    await this.state.storage.put("limits", { ips, hour });
    return { allowed: true, remaining: RATE_MAX_SUBMISSIONS - recent.length };
  }

  async fetch(request) {
    const url = new URL(typeof request === "string" ? request : request.url);
    if (url.pathname !== "/reserve") {
      return json({ code: "not_found" }, 404);
    }
    const body = await request.json().catch(() => ({}));
    return this.serialized(async () => json(await this.reserve(String(body.ipHash || "unknown"))));
  }
}

/** One Durable Object per submitted job: its configuration, state and result. */
export class BacktestJob {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.operation = Promise.resolve();
    this.serialized = serializedRunner(this);
  }

  async load() {
    return (await this.state.storage.get("job")) || null;
  }

  async create(payload) {
    const existing = await this.load();
    if (existing) {
      return json({ code: "duplicate_request", message: "This request already exists." }, 409);
    }
    const now = Date.now();
    const job = {
      requestId: payload.requestId,
      accessToken: payload.accessToken,
      status: "queued",
      message: "Queued for the backtest runner.",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      expiresAt: now + JOB_TTL_MS,
      error: null,
      errorCode: null,
      resultBytes: 0,
      chunkCount: 0,
      runId: null,
      config: payload.config,
      summary: payload.summary,
    };
    await this.state.storage.put("job", job);
    await this.state.storage.setAlarm(job.expiresAt);

    const dispatch = await this.dispatch(job);
    if (!dispatch.ok) {
      job.status = "failed";
      job.error = dispatch.message;
      job.errorCode = dispatch.code;
      job.completedAt = Date.now();
      job.updatedAt = job.completedAt;
      await this.state.storage.put("job", job);
      return json({ code: dispatch.code, message: dispatch.message }, 502);
    }
    return json({
      ok: true,
      requestId: job.requestId,
      accessToken: job.accessToken,
      status: job.status,
      // Server-side acceptance time, so a run can be timed end to end without
      // trusting the browser clock.
      acceptedAt: new Date(job.createdAt).toISOString(),
    }, 202);
  }

  async dispatch(job) {
    if (!this.env.GITHUB_REFRESH_TOKEN || !this.env.GITHUB_REPOSITORY) {
      return { ok: false, code: "misconfigured", message: "The backtest runner is not configured." };
    }
    const workflow = encodeURIComponent(
      this.env.GITHUB_BACKTEST_WORKFLOW_FILE || "custom-backtest.yml",
    );
    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/actions/workflows/${workflow}/dispatches`,
        {
          method: "POST",
          headers: { ...githubHeaders(this.env), "content-type": "application/json" },
          body: JSON.stringify({
            ref: this.env.GITHUB_REF || "main",
            // Only a correlation id travels with the dispatch; the runner
            // fetches the configuration over an authenticated channel.
            inputs: { request_id: job.requestId },
          }),
        },
      );
      if (!response.ok) {
        return {
          ok: false,
          code: response.status === 401 || response.status === 403
            ? "github_authorization_failed"
            : "dispatch_failed",
          message: "The backtest workflow could not be started.",
        };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        code: "dispatch_unavailable",
        message: "The backtest workflow could not be reached.",
      };
    }
  }

  async reconcile(job, now = Date.now()) {
    if (!job) return job;
    if (!["queued", "running"].includes(job.status)) return job;
    if (now - job.createdAt < JOB_TIMEOUT_MS) return job;
    // A runner that never called back (cancelled, killed, or lost) must not
    // leave the visitor polling forever.
    job.status = "failed";
    job.error = "The backtest did not finish in time. Please try again.";
    job.errorCode = "timeout";
    job.completedAt = now;
    job.updatedAt = now;
    await this.state.storage.put("job", job);
    return job;
  }

  async readResult(job) {
    const keys = Array.from({ length: job.chunkCount }, (_, index) => `r:${index}`);
    if (!keys.length) return "";
    const stored = await this.state.storage.get(keys);
    return keys.map((key) => stored.get(key) ?? "").join("");
  }

  async destroy() {
    const job = await this.load();
    if (job) {
      const keys = Array.from({ length: job.chunkCount || 0 }, (_, index) => `r:${index}`);
      if (keys.length) await this.state.storage.delete(keys);
    }
    await this.state.storage.delete("job");
    await this.state.storage.deleteAlarm();
  }

  async status(token) {
    const job = await this.reconcile(await this.load());
    if (!job) {
      return json({ code: "not_found", message: "No such backtest job." }, 404);
    }
    if (!safeEqual(String(token || ""), job.accessToken)) {
      // A guessed request id must never expose someone else's result.
      return json({ code: "forbidden", message: "This result is not available." }, 403);
    }
    if (Date.now() > job.expiresAt) {
      await this.destroy();
      return json({ code: "expired", message: "This backtest result has expired." }, 410);
    }

    const head = {
      requestId: job.requestId,
      status: job.status,
      message: job.message,
      stage: job.stage || null,
      createdAt: new Date(job.createdAt).toISOString(),
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
      completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : null,
      config: job.summary,
      error: job.error,
      code: job.errorCode,
      runId: job.runId ? String(job.runId) : null,
      timings: job.timings || null,
    };
    if (job.status !== "completed") {
      return new Response(JSON.stringify({ ...head, result: null }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    // Concatenate instead of re-serialising: the stored block is already JSON
    // text, and parsing a multi-megabyte value would burn the CPU budget.
    const encoded = JSON.stringify(head);
    const body = `${encoded.slice(0, -1)},"result":${await this.readResult(job)}}`;
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  async config() {
    const job = await this.load();
    if (!job) return json({ code: "not_found", message: "No such backtest job." }, 404);
    if (!["queued", "running"].includes(job.status)) {
      return json({ code: "job_not_active", message: "This job is no longer accepting work." }, 409);
    }
    return json({ requestId: job.requestId, status: job.status, config: job.config });
  }

  async callback(payload) {
    const job = await this.load();
    if (!job) return json({ code: "not_found", message: "No such backtest job." }, 404);
    if (payload.requestId !== job.requestId) {
      return json({ code: "request_mismatch", message: "The callback does not match this job." }, 409);
    }
    if (["completed", "failed"].includes(job.status)) {
      // Idempotent for the runner, but the stored outcome never changes.
      return json({ ok: true, duplicate: true, status: job.status });
    }

    const now = Date.now();
    if (payload.status === "running") {
      job.status = "running";
      // Only stages the runner can actually observe are accepted, so the page
      // never shows an invented progress percentage.
      const stage = RUNNER_STAGES.includes(payload.stage) ? payload.stage : job.stage || "preparing";
      job.stage = stage;
      job.message = STAGE_MESSAGES[stage];
      job.startedAt = job.startedAt || now;
      job.updatedAt = now;
      if (payload.runId) job.runId = String(payload.runId).slice(0, 32);
      await this.state.storage.put("job", job);
      return json({ ok: true, status: job.status, stage });
    }

    if (payload.status !== "completed" && payload.status !== "failed") {
      return json({ code: "invalid_status", message: "status must be running, completed or failed." }, 400);
    }

    if (payload.status === "failed") {
      const message = String(payload.error || "The backtest could not be completed.").slice(0, 400);
      const code = /^[a-z0-9_]{1,40}$/.test(String(payload.code || "")) ? String(payload.code) : "engine_failed";
      job.status = "failed";
      job.message = "The backtest could not be completed.";
      job.error = message;
      job.errorCode = code;
      job.completedAt = now;
      job.updatedAt = now;
      job.stage = null;
      const timings = sanitizedTimings(payload.timings);
      if (timings) job.timings = timings;
      if (payload.runId) job.runId = String(payload.runId).slice(0, 32);
      await this.state.storage.put("job", job);
      return json({ ok: true, status: job.status });
    }

    const problem = resultProblem(payload.result);
    if (problem) {
      return json({ code: "invalid_result", message: problem }, 400);
    }
    const encoded = JSON.stringify(payload.result);
    if (encoded.length > MAX_RESULT_BYTES) {
      return json({ code: "result_too_large", message: "The backtest result is too large to store." }, 413);
    }

    const chunks = [];
    for (let index = 0; index < encoded.length; index += RESULT_CHUNK_CHARS) {
      chunks.push({ key: `r:${chunks.length}`, body: encoded.slice(index, index + RESULT_CHUNK_CHARS) });
    }
    for (const chunk of chunks) {
      await this.state.storage.put(chunk.key, chunk.body);
    }

    job.status = "completed";
    job.message = "The backtest result is ready.";
    job.resultBytes = encoded.length;
    job.chunkCount = chunks.length;
    job.completedAt = now;
    job.startedAt = job.startedAt || now;
    job.updatedAt = now;
    job.stage = null;
    const timings = sanitizedTimings(payload.timings);
    if (timings) job.timings = timings;
    if (payload.runId) job.runId = String(payload.runId).slice(0, 32);
    await this.state.storage.put("job", job);
    return json({ ok: true, status: job.status, bytes: encoded.length });
  }

  async fetch(request) {
    const url = new URL(typeof request === "string" ? request : request.url);
    return this.serialized(async () => {
      if (url.pathname === "/status") {
        return this.status(url.searchParams.get("token") || "");
      }
      if (url.pathname === "/config") return this.config();
      if (url.pathname === "/callback") {
        const payload = await request.json().catch(() => null);
        if (!payload || typeof payload !== "object") {
          return json({ code: "invalid_request", message: "The callback body is invalid." }, 400);
        }
        return this.callback(payload);
      }
      if (url.pathname === "/create") {
        const payload = await request.json().catch(() => null);
        if (!payload?.requestId || !payload?.accessToken || !payload?.config) {
          return json({ code: "invalid_request", message: "The job payload is incomplete." }, 400);
        }
        return this.create(payload);
      }
      return json({ code: "not_found" }, 404);
    });
  }

  async alarm() {
    await this.destroy();
  }
}

function backtestConfigured(env) {
  return Boolean(
    env.BACKTEST_JOB
    && env.BACKTEST_LIMITER
    && env.GITHUB_REFRESH_TOKEN
    && env.GITHUB_REPOSITORY
    && env.BACKTEST_CALLBACK_TOKEN
    && env.TURNSTILE_SECRET_KEY
    && list(env.REFRESH_ALLOWED_ORIGINS).length,
  );
}

function internalTokenValid(request, env) {
  const expected = env.BACKTEST_CALLBACK_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") || "";
  return safeEqual(header, `Bearer ${expected}`);
}

function jobStub(env, requestId) {
  return env.BACKTEST_JOB.get(env.BACKTEST_JOB.idFromName(requestId));
}

async function handleBacktestSubmit(request, env, origin) {
  let body;
  try {
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_CONFIG_CHARS * 2) {
      return errorResponse("invalid_request", "Backtest request body is too large.", 413, origin);
    }
    const text = await request.text();
    if (text.length > MAX_CONFIG_CHARS * 2) {
      return errorResponse("invalid_request", "Backtest request body is too large.", 413, origin);
    }
    body = JSON.parse(text);
  } catch {
    return errorResponse("invalid_request", "Backtest request body is invalid.", 400, origin);
  }

  const verification = await verifyTurnstileFor(
    request,
    body?.challengeToken,
    env,
    env.TURNSTILE_BACKTEST_ACTION || "backtest",
  ).catch(() => ({ ok: false, code: "verification_unavailable" }));
  if (!verification.ok) {
    return errorResponse(
      verification.code,
      verification.code === "verification_unavailable"
        ? "Backtest verification is unavailable."
        : "Backtest verification failed.",
      verification.code === "verification_unavailable" ? 503 : 401,
      origin,
    );
  }

  const validated = validateBacktestConfig(body?.config);
  if (!validated.ok) {
    return errorResponse(validated.code, validated.message, 400, origin);
  }

  const limiter = env.BACKTEST_LIMITER.get(env.BACKTEST_LIMITER.idFromName("global"));
  const admission = await limiter.fetch(new Request("https://limiter.internal/reserve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ipHash: await ipFingerprint(request) }),
  })).then((response) => response.json()).catch(() => null);
  if (!admission?.allowed) {
    return json({
      code: admission?.code || "capacity",
      message: admission?.message || "The backtest runner is busy. Try again later.",
      retryAt: admission?.retryAt ? new Date(admission.retryAt).toISOString() : null,
    }, admission?.code === "rate_limited" ? 429 : 503, origin);
  }

  const requestId = crypto.randomUUID();
  const accessToken = randomToken();
  const config = validated.config;
  const created = await jobStub(env, requestId).fetch(new Request("https://job.internal/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId,
      accessToken,
      config,
      summary: {
        portfolio: config.portfolio,
        rebalanceFrequency: config.rebalance_frequency,
        start: config.start,
        end: config.end,
        initialCapital: config.initial_capital,
        cashflowEnabled: config.cashflow_enabled,
        cashflowAmount: config.cashflow_amount,
        cashflowFrequency: config.cashflow_frequency,
        cashflowDirection: config.cashflow_direction,
      },
    }),
  })).catch(() => null);

  if (!created) {
    return errorResponse("job_unavailable", "The backtest could not be queued.", 503, origin);
  }
  const response = await created.json().catch(() => ({}));
  if (!created.ok) {
    return json({
      code: response.code || "dispatch_failed",
      message: response.message || "The backtest could not be queued.",
    }, created.status === 409 ? 409 : 502, origin);
  }

  return json({
    requestId: response.requestId,
    accessToken: response.accessToken,
    status: response.status || "queued",
    acceptedAt: response.acceptedAt || null,
    // Two seconds: the runner finishes within ~10-30 s once it starts, and a
    // job costs roughly 20-60 polls at this rate. Well inside the 100,000
    // requests/day free allowance, and dispatch is rate limited separately.
    pollIntervalMs: 2000,
  }, 202, origin);
}

async function handleBacktestStatus(request, env, origin) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId") || "";
  const token = url.searchParams.get("token")
    || request.headers.get("x-umt-backtest-token")
    || "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return errorResponse("invalid_request", "A request id is required.", 400, origin);
  }
  const response = await jobStub(env, requestId).fetch(
    `https://job.internal/status?token=${encodeURIComponent(token)}`,
  );
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

async function handleBacktestInternal(request, env, path) {
  if (!internalTokenValid(request, env)) {
    return errorResponse("unauthorized", "This endpoint requires runner authentication.", 401);
  }
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId") || "";
  if (path === "/api/backtest/callback") {
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_RESULT_BYTES + 65_536) {
      return errorResponse("payload_too_large", "The result is too large to store.", 413);
    }
    let requestIdFromBody = "";
    let bodyText;
    try {
      // Read once, so both the id lookup and the stored body come from the
      // same bytes; the runner sends at most a few megabytes.
      bodyText = await request.text();
    } catch {
      return errorResponse("invalid_request", "The callback body could not be read.", 400);
    }
    if (bodyText.length > MAX_RESULT_BYTES + 65_536) {
      return errorResponse("payload_too_large", "The result is too large to store.", 413);
    }
    try {
      requestIdFromBody = String(JSON.parse(bodyText)?.requestId || "");
    } catch {
      return errorResponse("invalid_request", "The callback body is invalid.", 400);
    }
    if (!/^[0-9a-f-]{36}$/i.test(requestIdFromBody)) {
      return errorResponse("invalid_request", "The callback is missing a request id.", 400);
    }
    const response = await jobStub(env, requestIdFromBody).fetch(
      new Request("https://job.internal/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyText,
      }),
    );
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  }

  // Runner configuration retrieval.
  if (request.method !== "GET") {
    return errorResponse("method_not_allowed", "Use GET for this endpoint.", 405);
  }
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return errorResponse("invalid_request", "A request id is required.", 400);
  }
  const response = await jobStub(env, requestId).fetch("https://job.internal/config");
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!ROUTES.includes(url.pathname)) {
      return errorResponse("not_found", "API route not found.", 404);
    }

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return errorResponse("method_not_allowed", "Use GET for this endpoint.", 405);
      }
      return json({
        status: "ok",
        service: "umt-refresh-broker",
        schemaVersion: 2,
        configured: Boolean(
          env.REFRESH_COORDINATOR
          && env.GITHUB_REFRESH_TOKEN
          && env.GITHUB_REPOSITORY
          && env.TURNSTILE_SECRET_KEY
          && env.TURNSTILE_ACTION
          && list(env.REFRESH_ALLOWED_ORIGINS).length
          && list(env.REFRESH_ALLOWED_HOSTS).length
        ),
        checks: {
          coordinator: Boolean(env.REFRESH_COORDINATOR),
          githubRepository: Boolean(env.GITHUB_REPOSITORY),
          githubToken: Boolean(env.GITHUB_REFRESH_TOKEN),
          turnstileSecret: Boolean(env.TURNSTILE_SECRET_KEY),
          turnstileAction: Boolean(env.TURNSTILE_ACTION),
          allowedOrigin: list(env.REFRESH_ALLOWED_ORIGINS).length > 0,
          allowedHostname: list(env.REFRESH_ALLOWED_HOSTS).length > 0,
        },
        backtest: {
          configured: backtestConfigured(env),
          job: Boolean(env.BACKTEST_JOB),
          limiter: Boolean(env.BACKTEST_LIMITER),
          callbackToken: Boolean(env.BACKTEST_CALLBACK_TOKEN),
          workflow: Boolean(env.GITHUB_BACKTEST_WORKFLOW_FILE || "custom-backtest.yml"),
          turnstileAction: Boolean(env.TURNSTILE_BACKTEST_ACTION || "backtest"),
        },
      });
    }

    // The GitHub Actions runner is not a browser: it authenticates with the
    // shared callback token and never sends an Origin header.
    if (url.pathname === "/api/backtest/job" || url.pathname === "/api/backtest/callback") {
      return handleBacktestInternal(request, env, url.pathname);
    }

    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") {
      return origin
        ? new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(origin),
            "cache-control": "no-store",
          },
        })
        : errorResponse("forbidden", "Request origin rejected.", 403);
    }
    if (!origin) {
      return errorResponse("forbidden", "Refresh request rejected.", 403);
    }

    if (url.pathname.startsWith("/api/backtest")) {
      if (!backtestConfigured(env)) {
        return errorResponse("misconfigured", "Backtest service is not configured.", 503, origin);
      }
      if (url.pathname === "/api/backtest/status") {
        if (request.method !== "GET") {
          return errorResponse("method_not_allowed", "Use GET for this endpoint.", 405, origin);
        }
        try {
          return await handleBacktestStatus(request, env, origin);
        } catch {
          return errorResponse("backtest_unavailable", "The backtest status is unavailable.", 502, origin);
        }
      }
      if (request.method !== "POST") {
        return errorResponse("method_not_allowed", "Use POST for this endpoint.", 405, origin);
      }
      try {
        return await handleBacktestSubmit(request, env, origin);
      } catch {
        return errorResponse("backtest_unavailable", "The backtest could not be queued.", 502, origin);
      }
    }

    if (!env.REFRESH_COORDINATOR) {
      return errorResponse("misconfigured", "Refresh service is not configured.", 503, origin);
    }

    const id = env.REFRESH_COORDINATOR.idFromName(env.GITHUB_REPOSITORY || "default");
    const coordinator = env.REFRESH_COORDINATOR.get(id);

    if (url.pathname === "/api/status") {
      if (request.method !== "GET") {
        return errorResponse("method_not_allowed", "Use GET for this endpoint.", 405, origin);
      }
      const requestedId = url.searchParams.get("requestId") || "";
      const internal = new URL("https://refresh.internal/status");
      if (requestedId) internal.searchParams.set("requestId", requestedId);
      const response = await coordinator.fetch(internal.toString());
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    }

    if (request.method !== "POST") {
      return errorResponse("method_not_allowed", "Use POST for this endpoint.", 405, origin);
    }
    let challengeToken = "";
    try {
      challengeToken = await readChallengeToken(request);
    } catch {
      return errorResponse("invalid_request", "Refresh request body is invalid.", 400, origin);
    }
    let verification;
    try {
      verification = await verifyTurnstile(request, challengeToken, env);
    } catch {
      return errorResponse("verification_unavailable", "Refresh verification is unavailable.", 503, origin);
    }
    if (!verification.ok) {
      return errorResponse(
        verification.code,
        verification.code === "verification_unavailable"
          ? "Refresh verification is unavailable."
          : "Refresh verification failed.",
        verification.code === "verification_unavailable" ? 503 : 401,
        origin,
      );
    }

    const response = await coordinator.fetch("https://refresh.internal/dispatch");
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};

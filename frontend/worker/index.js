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
    "access-control-allow-headers": "content-type",
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

async function verifyTurnstile(request, challengeToken, env) {
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
  const expectedAction = env.TURNSTILE_ACTION || "refresh";
  if (result.action !== expectedAction) {
    return { ok: false, code: "verification_failed" };
  }
  return { ok: true };
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!["/api/refresh", "/api/status", "/api/health"].includes(url.pathname)) {
      return errorResponse("not_found", "API route not found.", 404);
    }

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return errorResponse("method_not_allowed", "Use GET for this endpoint.", 405);
      }
      return json({
        status: "ok",
        service: "umt-refresh-broker",
        schemaVersion: 1,
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
      });
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

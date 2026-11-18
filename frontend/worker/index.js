function json(body, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.REFRESH_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim());
  return origin && allowed.includes(origin) ? origin : "";
}

async function verifyTurnstile(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body?.challengeToken || !env.TURNSTILE_SECRET_KEY) return false;
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", body.challengeToken);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (result?.success !== true) return false;
  const expectedHosts = String(env.REFRESH_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (expectedHosts.length && !expectedHosts.includes(result.hostname)) return false;
  return !env.TURNSTILE_ACTION || result.action === env.TURNSTILE_ACTION;
}

function manifestUrl(env) {
  if (env.PUBLIC_MANIFEST_URL) return env.PUBLIC_MANIFEST_URL;
  const [owner, repository] = String(env.GITHUB_REPOSITORY || "").split("/");
  if (!owner || !repository) return "";
  return `https://${owner}.github.io/${repository}/data/manifest.json`;
}

async function publicationExistsSince(env, requestedAt) {
  const url = manifestUrl(env);
  if (!url) return false;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
    });
    if (!response.ok) return false;
    const manifest = await response.json();
    const generatedAt = Date.parse(manifest?.generatedAt ?? "");
    const requested = typeof requestedAt === "number" ? requestedAt : Date.parse(requestedAt);
    return Number.isFinite(generatedAt) && Number.isFinite(requested) && generatedAt >= requested;
  } catch {
    return false;
  }
}

export class RefreshCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Durable Object events can overlap while an external fetch is pending.
    // This in-instance queue makes the active check, dispatch and state write
    // one serialized critical section across every request to the object.
    this.operation = Promise.resolve();
  }

  async dispatch() {
    const now = Date.now();
    let active = await this.state.storage.get("active");
    if (active && now - active.requestedAt < 20 * 60 * 1000) {
      // A workflow that completed successfully is recognized from the public
      // Pages manifest. This releases the lock without granting the Worker
      // any extra secret or trusting a client-supplied "finished" flag.
      if (await publicationExistsSince(this.env, active.requestedAt)) {
        await this.state.storage.delete("active");
        return json({ accepted: true, alreadyRunning: false, publicationAvailable: true });
      }
      return json({ accepted: true, alreadyRunning: true });
    }
    if (active) await this.state.storage.delete("active");
    if (!this.env.GITHUB_REFRESH_TOKEN || !this.env.GITHUB_REPOSITORY) {
      return json({ code: "misconfigured", message: "Refresh service is not configured." }, 503);
    }
    active = { requestedAt: now };
    await this.state.storage.put("active", active);
    const workflow = this.env.GITHUB_WORKFLOW_FILE || "deploy-pages.yml";
    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
        {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${this.env.GITHUB_REFRESH_TOKEN}`,
            "x-github-api-version": "2022-11-28",
            "content-type": "application/json",
            "user-agent": "us-momentum-refresh-broker",
          },
          body: JSON.stringify({ ref: this.env.GITHUB_REF || "main", inputs: { refresh_reason: "visitor-request" } }),
        },
      );
      if (!response.ok) {
        await this.state.storage.delete("active");
        return json({ code: "dispatch_failed", message: "The refresh request could not be started." }, 502);
      }
    } catch {
      await this.state.storage.delete("active");
      return json({ code: "dispatch_failed", message: "The refresh request could not be reached." }, 503);
    }
    return json({ accepted: true, alreadyRunning: false });
  }

  async fetch() {
    let release;
    const previous = this.operation;
    this.operation = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await this.dispatch();
    } finally {
      release();
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/refresh") {
      const origin = allowedOrigin(request, env);
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: origin ? 204 : 403,
          headers: origin ? {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            vary: "Origin",
          } : {},
        });
      }
      if (request.method !== "POST" || !origin) return json({ code: "forbidden", message: "Refresh request rejected." }, 403);
      if (!env.REFRESH_COORDINATOR) return json({ code: "misconfigured", message: "Refresh service is not configured." }, 503, origin);
      let verified = false;
      try {
        verified = await verifyTurnstile(request, env);
      } catch {
        return json({ code: "verification_unavailable", message: "Refresh verification is unavailable." }, 503, origin);
      }
      if (!verified) {
        return json({ code: "verification_failed", message: "Refresh verification failed." }, 401, origin);
      }
      const id = env.REFRESH_COORDINATOR.idFromName(env.GITHUB_REPOSITORY || "default");
      const response = await env.REFRESH_COORDINATOR.get(id).fetch("https://refresh.internal/dispatch");
      const headers = new Headers(response.headers);
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "Origin");
      return new Response(response.body, { status: response.status, headers });
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("the refresh broker is API-only and never consumes a static ASSETS binding", async () => {
  let assetCalls = 0;
  for (const request of [
    new Request("https://example.test/assets/app.js"),
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    new Request("https://example.test/api/missing", {
      headers: { accept: "application/json" },
    }),
  ]) {
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          assetCalls += 1;
          return new Response("static site", { status: 200 });
        },
      },
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.code, "not_found");
  }
  assert.equal(assetCalls, 0);
});

test("health remains public and reports broker configuration", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/health"),
    {
      REFRESH_COORDINATOR: {},
      GITHUB_REPOSITORY: "andyttc05/us-momentum-terminal",
      GITHUB_REFRESH_TOKEN: "test-only",
      TURNSTILE_SECRET_KEY: "test-only",
      TURNSTILE_ACTION: "refresh",
      REFRESH_ALLOWED_ORIGINS: "https://andyttc05.github.io",
      REFRESH_ALLOWED_HOSTS: "andyttc05.github.io",
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.configured, true);
  assert.doesNotMatch(JSON.stringify(body), /test-only/);
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

# Optional secure refresh broker

GitHub Pages stays the production host. It cannot safely hold a GitHub token,
so the **Refresh market data** action is intentionally unavailable until a
small, separately deployed Cloudflare Worker is configured. The ordinary
**Check for updates** action always works against Pages and needs no broker.

The broker accepts only `POST /api/refresh` from the configured Pages origin.
It verifies a short-lived Cloudflare Turnstile token and its action/hostname,
then sends a `workflow_dispatch` request to the existing Pages workflow. A
Durable Object serializes the check-and-dispatch critical section, so
concurrent visitors receive `alreadyRunning` instead of dispatching duplicate
Actions jobs. Its durable active marker protects against duplicates for up to
20 minutes and is released as soon as the public manifest shows a publication
generated after the request. GitHub Actions also retains its existing `pages`
concurrency group.

The browser polls the Pages manifest and shows **Updated** only after a newer,
manifest-matching and complete publication is actually visible. An accepted
dispatch, a 200 response for unchanged JSON, or a timeout is never reported as
updated. The previous valid browser snapshot remains visible on verification,
dispatch, validation or timeout failure.

## Deploy

1. Copy `frontend/worker/wrangler.refresh.example.toml` to a private
   `wrangler.toml` beside `frontend/worker/index.js`; retain the Durable Object
   binding, set the Pages origin/hostname exactly, and keep the Turnstile action
   as `refresh`. The local `wrangler.toml` is git-ignored.
2. Configure a Turnstile widget for that Pages origin. Set the public site key
   as `VITE_TURNSTILE_SITE_KEY` during the Pages build and set its secret with
   `wrangler secret put TURNSTILE_SECRET_KEY`.
3. Create a repository-scoped fine-grained GitHub token with only the minimum
   Actions read/write permission needed for this repository. Store it
   with `wrangler secret put GITHUB_REFRESH_TOKEN`. Never place it in Vite,
   Pages variables, source code, or a browser request.
4. Deploy the worker at a dedicated URL and build Pages with
   `VITE_REFRESH_BROKER_URL=https://refresh.example.com` and the public
   `VITE_TURNSTILE_SITE_KEY`. In GitHub, set both as repository Actions
   variables (not secrets) so the Pages workflow builds the opt-in UI. The
   broker URL is public; the Worker still requires the allowed Origin and a
   valid Turnstile token.

If the workflow runs under a custom Pages hostname, set `PUBLIC_MANIFEST_URL`
to its full `/data/manifest.json` URL so completed refreshes can release the
durable lock promptly.

If any setting is absent the site remains fully static and keeps scheduled
updates. The refresh dialog reports the feature as unavailable rather than
falling back to an unsafe client-side GitHub request.

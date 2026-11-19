# Secure refresh broker

GitHub Pages stays the production host. It cannot safely hold a GitHub token,
so a small Cloudflare Worker brokers the workflow request. The Worker never
hosts application assets and never runs Python. It exposes:

- `POST /api/refresh`
- `GET /api/status`
- `GET /api/health`
- `POST /api/backtest`, `GET /api/backtest/status`,
  `GET /api/backtest/job`, `POST /api/backtest/callback`
  (see [DYNAMIC_BACKTEST.md](DYNAMIC_BACKTEST.md))

Unknown or non-API routes return a controlled JSON `404`.

The broker accepts only `POST /api/refresh` from the configured Pages origin.
It verifies a short-lived Cloudflare Turnstile token and its action/hostname,
then sends a `workflow_dispatch` request to the existing Pages workflow. A
Durable Object serializes the check-and-dispatch critical section, so
concurrent visitors receive `alreadyRunning` instead of dispatching duplicate
Actions jobs. The marker follows the actual queued/running GitHub workflow and
does not release while the workflow is still active. If GitHub status cannot be
checked, the lock remains in place rather than risking a duplicate scraper.
Definitive failures receive a 15-minute backoff; successful publications receive
a 15-minute cooldown. GitHub Actions also retains its existing `pages`
concurrency group.

On first application load, the browser renders its last valid local copy or the
current published snapshot, checks the manifest, obtains the invisible
Turnstile assertion, and starts or joins a refresh. A session claim prevents
React StrictMode and route navigation from creating duplicate requests. The
browser polls every 15 seconds for up to 50 minutes, covering the workflow's
45-minute runner limit. It shows **Updated** only after a newer,
manifest-matching and complete publication is actually visible. An accepted
dispatch, a 200 response for unchanged JSON, or a timeout is never reported as
updated. The previous valid snapshot remains visible on verification,
dispatch, validation, workflow or timeout failure.

## Deploy

1. Deploy beside `frontend/worker/index.js` with
   `wrangler.refresh.example.toml` (copy it to the git-ignored `wrangler.toml`);
   retain every SQLite Durable Object binding and migration, set the Pages
   origin/hostname exactly, and keep the Turnstile actions as `refresh` and
   `backtest`. Adding the backtest classes is migration `v2`; reusing an applied
   tag fails the deploy.
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
5. For on-demand backtests, also store the same random token as the Worker
   secret `BACKTEST_CALLBACK_TOKEN` and as the Actions repository secret of the
   same name. The runner reads it from the environment; it is never a workflow
   input. See [DYNAMIC_BACKTEST.md](DYNAMIC_BACKTEST.md).

If the workflow runs under a custom Pages hostname, set `PUBLIC_MANIFEST_URL`
to its full `/data/manifest.json` URL so completed refreshes can release the
durable lock promptly.

If any setting is absent the site remains fully static and keeps scheduled
updates. The refresh dialog reports the feature as unavailable rather than
falling back to an unsafe client-side GitHub request. Turnstile's
[privacy addendum](https://www.cloudflare.com/turnstile-privacy-policy/) is
referenced in the application's About panel and `PRIVACY.md`.

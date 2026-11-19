# On-demand custom backtests

A custom date range cannot be answered from the published JSON: it needs a real
simulation over the cached price history. Running a Python server permanently
would cost money, so the calculation is executed only when someone asks for it.

```
GitHub Pages (browser)
        │  POST /api/backtest  (Turnstile assertion + configuration)
        ▼
Cloudflare Worker ──────────────► Durable Object (one per job)
        │  workflow_dispatch             │  configuration
        ▼                                │  status
GitHub Actions (custom-backtest.yml)     │  result chunks
        │  checkout + pip + cache        │
        ▼                                │
Python runner ──► app.snapshot.run_historical_backtest
        │                                ▲
        └── POST /api/backtest/callback ─┘
                                         │
        browser polls every 4 s ─────────┘
```

Nothing is always-on. A run lasts about a minute with a warm data cache and
about five to ten minutes on a cold one.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/backtest` | Origin allowlist + Turnstile (`backtest` action) + rate limit | Validate, store and dispatch one job. Returns `requestId`, `accessToken`, `status`. |
| `GET /api/backtest/status` | `requestId` + `accessToken` | Path only the submitting browser knows, so a guessed id cannot read someone else's result. |
| `GET /api/backtest/job` | `Authorization: Bearer $BACKTEST_CALLBACK_TOKEN` | Runner-only configuration retrieval. |
| `POST /api/backtest/callback` | `Authorization: Bearer $BACKTEST_CALLBACK_TOKEN` | Runner-only result delivery (`running` / `completed` / `failed`). |

`/api/refresh`, `/api/status` and `/api/health` are unchanged. Health now also
reports whether the backtest bindings are configured.

## State machine

```
queued ──running──► completed
   │                    │
   └──failed◄───────────┘   (never the other way round)
```

- A callback that arrives for a job that is already finished is acknowledged and
  discarded, so a retry cannot overwrite a delivered result.
- A job that produces no callback is failed by the Durable Object after 45
  minutes, which is shorter than the workflow's own timeout plus queueing.
- Results are retained for 24 hours and then deleted by a Durable Object alarm.
  The status endpoint answers `410` once a result has expired.

## Progress the page can actually show

The runner reports a stage at each real checkpoint and the Durable Object stores
it; nothing is estimated.

| Job state | Stage | Card text |
| --- | --- | --- |
| queued | – | Waiting for a backtest runner… |
| running | `preparing` | Preparing historical market data… |
| running | `calculating` | Running the historical simulation… |
| running | `delivering` | Validating and returning results… |
| completed | – | Backtest completed |

`preparing` is genuinely short with a warm cache (the engine starts within about
half a second of the configuration arriving), so in practice a run shows the
queue text and then the simulation text. A stage the runner never reports is
never displayed.

The card itself is persistent for the whole run: `durationMs: null` means no
timer is armed, and it has no close button, so it cannot vanish between polls.
Elapsed time is appended locally and stops when the job ends.

## Polling

Every **2 seconds**, which is the fastest cadence that still leaves a wide
margin on the free plan: a run costs roughly 20–60 polls, so even 20 jobs an
hour (the admission cap) stay around 1,200 Worker requests per hour against a
100,000/day allowance. The interval comes from the submission response, so it
can be retuned without shipping new frontend code.

Polling stops immediately on `completed`, on `failed`, on a superseded run, and
on the ten-minute client deadline. Three consecutive transport errors end the
poll with a retryable message; a single dropped request is survived silently, so
a transient network blip cannot make the progress card disappear.

## Storage

One Durable Object per job, created from its request id. Jobs live in a
SQLite-backed Durable Object using the key-value storage API on top of it:

| Key | Contents |
| --- | --- |
| `job` | configuration, state, timestamps, error code, chunk count |
| `r:0…n` | the serialized result in 200,000-character chunks |

Chunking matters: the platform caps a single stored value at 8 MB, and a
top-100 monthly run over eight years is roughly 1.6 MB. A 6 MB ceiling is
enforced before anything is written, and an oversized payload is refused
instead of being silently truncated.

A single `BacktestRateLimiter` instance holds every admission counter so the
check is atomic: 5 submissions per connection per 15 minutes, and 20 dispatches
per hour account-wide. Only a truncated SHA-256 fingerprint of the client
address is stored.

## Secrets

| Name | Where | Purpose |
| --- | --- | --- |
| `GITHUB_REFRESH_TOKEN` | Worker secret | Dispatch `workflow_dispatch` from the Worker. Already existed for the refresh broker. |
| `BACKTEST_CALLBACK_TOKEN` | Worker secret **and** GitHub Actions repository secret | Authenticates the runner on both the configuration and callback routes. The two values must match. |
| `TURNSTILE_SECRET_KEY` | Worker secret | Verifies the browser assertion. Already existed. |
| `BACKTEST_API_URL` | Repository *variable* (optional) | Defaults to the deployed Worker URL. Public, not a secret. |

`BACKTEST_CALLBACK_TOKEN` is generated locally
(`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`) and written
directly into both secret stores. It never appears in source, logs, build
output or workflow inputs.

## Free-tier budget

Measured against the Workers Free plan, which this deployment runs on:

| Resource | Free allowance | This workload |
| --- | --- | --- |
| Workers requests | 100,000/day | A few hundred at most; each page poll is one request. |
| Durable Object requests | 100,000/day | ~3 per submission plus 1 per poll (one poll every 2 s). |
| Durable Object duration | 13,000 GB-s/day | Millisecond handlers, no hibernation needed. |
| Durable Object storage | 5 GB total, 1 GB per object | ~2 MB per job, deleted after 24 hours. |
| SQL row size | 8 MB | 200,000-character chunks. |
| GitHub Actions minutes | Unlimited for public repositories | One runner per request, 30-minute cap. |
| Actions cache | 10 GB per repository | 24 MB per market-data entry (read-only from here) plus one 66 MB package entry keyed by the requirements hash. |

Durable Objects with a SQLite backend are the only kind the Free plan can
create, which is why both new classes are declared with
`new_sqlite_classes`.

## Workflow

`.github/workflows/custom-backtest.yml` receives **only** the request id. It
checks out the repository, installs `data-service/requirements.txt`, restores
the shared market-data cache, runs
`data-service/scripts/custom_backtest.py`, and reports a failure if the run
stops before it could do that itself.

`concurrency.group` is the request id, so a duplicate dispatch is serialized
rather than calculated twice. The run does not touch the publication workflow:
no snapshot is rebuilt and no Pages artifact is uploaded.

Two cache decisions keep the runner cheap:

- **Installed packages are cached**, keyed by the requirements hash. A cold run
  spends ~11 s installing pandas/numpy; a warm one restores the tree in ~2 s and
  skips the install entirely. Pinned versions cannot drift, because the key
  changes with the file.
- **The market-data cache is restored but never re-saved.** The publication
  workflow saves the same 189 MB directory on every scheduled run; re-saving it
  from a backtest would churn the 10 GB repository budget and evict the entries
  that workflow depends on.

## Measured stages

One warm run, `top20`/`quarterly`, from a real browser on the published site.
Every figure is a timestamp recorded by the browser, the Worker or the runner —
none is estimated.

| Stage | Before | After |
| --- | --- | --- |
| Submit → Worker acceptance | ~1.1 s | ~1.3 s |
| Acceptance → runner starts (dispatch + queue + checkout + packages + cache) | 26.6 s | 12.5 s |
| Runner start → configuration fetched | 0.6 s | 0.7 s |
| Configuration → engine start | 0.5 s | 0.5 s |
| Python calculation | 7.8 s | 6.3 s |
| Engine end → result callback | 0.3 s | 0.2 s |
| Callback → browser renders it | 4.7 s | 1.3 s |
| **Total, click to dashboard** | **41.7 s** | **22.3 s** |

Same-window engine measurement on one machine (`top100`/`semiannual`,
2020-01-02 → 2024-12-31): **9.0 s → 4.4 s**. The saving is entirely in the
sizing pre-pass; the simulation itself is unchanged.

What the profiling ruled out:

- **Restoring the 189 MB market-data cache takes ~1–2 s.** It is not the
  bottleneck, and its 715 files are exactly the price and share history the
  engine reads, so nothing is pruned.
- **Most of the wall time is GitHub's queue and job start-up**, not this
  repository's code. The runner is also ~40 % slower than a developer machine at
  the same calculation, which is a property of the shared free runners.
- **The one real duplicate was a network call**: `ensure_share_history`
  re-downloaded the renamed tickers (FB, UTX) on every run, because their series
  can never become "fresh" again. Their share counts are still used exactly as
  before; a successful fetch is now stamped and not repeated for seven days, and
  a failed fetch stays retryable. The runner logs the outcome:

  ```json
  {"shareHistory": {"requested": 108, "resolved": 108, "fetched": 0, "missing": 0, "ms": 46}}
  ```

  `fetched: 0` is the healthy case. A non-zero value means the run paid for a
  provider round trip.

## Local checks

```bash
python data-service/scripts/custom_backtest.py \
  --config-file /tmp/job.json --output /tmp/result.json   # no network, local cache

python -m unittest discover -s data-service/tests -p "test_*.py"
npm --prefix frontend run test:unit
```

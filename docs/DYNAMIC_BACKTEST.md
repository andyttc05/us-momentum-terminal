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
| Durable Object requests | 100,000/day | ~2 per submission plus 1 per poll. |
| Durable Object duration | 13,000 GB-s/day | Millisecond handlers, no hibernation needed. |
| Durable Object storage | 5 GB total, 1 GB per object | ~2 MB per job, deleted after 24 hours. |
| SQL row size | 8 MB | 200,000-character chunks. |
| GitHub Actions minutes | Unlimited for public repositories | One runner per request, 30-minute cap. |
| Actions cache | 10 GB per repository | Shares the `market-data-<os>-` namespace with the publication workflow. |

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

## Local checks

```bash
python data-service/scripts/custom_backtest.py \
  --config-file /tmp/job.json --output /tmp/result.json   # no network, local cache

python -m unittest discover -s data-service/tests -p "test_*.py"
npm --prefix frontend run test:unit
```

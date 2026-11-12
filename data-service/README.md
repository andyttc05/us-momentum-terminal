# Data Service

Provider-independent market data layer for the US Momentum Terminal.

The React app never talks to a data provider and never sees an API key. It calls this service on
`/api/...`; the service fetches, validates, normalizes, caches and scores the data, then hands the
browser one consistent publication object.

```
Browser (React SPA)
   │  fetch /api/snapshot  (same origin, proxied by Vite)
   ▼
FastAPI service :8787
   ├── provider registry  ── Yahoo (primary) → Twelve Data → FMP
   ├── validation + dedupe + provenance
   ├── momentum engine (pandas/numpy)
   ├── portfolio builder (market-cap weights + caps)
   ├── backtest engine (monthly rebalance, real adjusted prices)
   └── disk cache (TTL by data type)
```

## Run

```bash
# once, from the repository root
npm run data:install

# every session
npm run data:serve

# then, in frontend/
npm run dev        # or: npm run preview
```

`frontend/vite.config.mjs` proxies `/api` to `http://127.0.0.1:8787` for both `dev` and `preview`.
Point it elsewhere with `DATA_SERVICE_URL=... npm run preview`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | service state, market clock, provider health, cache age |
| `GET` | `/api/snapshot` | the whole dashboard payload (stocks, overview, portfolio, backtest, meta) |
| `GET` | `/api/stock/{ticker}` | price history, monthly rank history, momentum detail |
| `GET` | `/api/bars/{ticker}?days=N` | normalized daily OHLCV + adjusted close + corporate actions |
| `GET` | `/api/providers` | adapter status, roles, circuit-breaker state |
| `GET` | `/api/probe` | last recorded live probe of every candidate provider |
| `POST` | `/api/refresh` | force a provider re-pull and rebuild the publication |

## Normalized record

Every bar, whatever the provider, is stored as:

```json
{
  "symbol": "AAPL",
  "date": "2026-11-11",
  "open": 349.58, "high": 355.33, "low": 349.33, "close": 355.13,
  "adjusted_close": 355.13,
  "volume": 81300700,
  "market_cap": 5154347155456,
  "dividends": 0.0,
  "stock_splits": 0.0,
  "data_source": "yahoo",
  "last_updated": "2026-11-11T19:07:52+00:00"
}
```

`data_source` and `last_updated` travel with the data all the way to the UI, so every number can be
traced back to the provider and the moment it was fetched.

## Universe

The live source universe contains 308 unique US common stocks: 108 audited core symbols plus 200
sector-balanced S&P MidCap 400 additions. The market-data service still applies the same exchange,
security-type, currency, price, history and liquidity tests. The historical backtest remains on the
108-symbol audited core so today's additions are not applied retrospectively.

## Providers

| id | Role | Key | Notes |
|---|---|---|---|
| `yahoo` | primary | none | yfinance; adjusted close, market cap, splits, dividends |
| `stooq` | optional | none | unadjusted CSV only; blocked by a bot wall and excluded from the default scoring chain |
| `twelvedata` | backup | `TWELVEDATA_API_KEY` | 8 req/min, 800/day; free plan is evaluation-only |
| `fmp` | backup | `FMP_API_KEY` | 250 req/day; adjusted EOD |

Configured order comes from `DATA_PROVIDER_CHAIN` (default `yahoo,twelvedata,fmp`); adapters
without a key are skipped automatically. Failover is per request: the first adapter that answers
wins, and the payload records `is_backup` plus the symbols that needed it.

### Behaviour when a provider fails

* **Bounded batches** — bar requests run in 40-symbol batches with controlled concurrency, and
  per-symbol recovery uses a separate worker pool and limited exponential backoff.
* **Circuit breaker** — after 3 consecutive hard failures a provider is benched for 180 s, so a
  dead source cannot serialise a large-universe refresh.
* **No silent substitution** — symbols that no provider can serve are dropped from the ranking and
  reported in `universe.unavailable`. Nothing is back-filled with a placeholder price.
* **No stale promotion** — an expired cache entry is refetched; if the refetch fails the symbol is
  marked unavailable rather than served as if fresh.
* **Adjusted-only scoring** — a provider that cannot supply adjusted closes has its series flagged
  `adjusted: false`, and the momentum engine refuses to score it instead of mixing price bases.

## Caching

| Data | TTL |
|---|---|
| daily bars | 15 min while the session is open, 6 h otherwise |
| quotes / market cap / sector | 24 h |
| publication (dashboard payload) | 15 min |
| stock detail | 15 min |

Cache lives in `data-service/cache/` as JSON (git-ignored). Override the location with
`DATA_CACHE_DIR` (used by the failover tests).

## Momentum engine

Windows are trading sessions, not calendar months: 21 / 63 / 126 / 252.

```
momentum_1m  = P(t)     / P(t-21)  - 1
momentum_3m  = P(t)     / P(t-63)  - 1
momentum_6m  = P(t)     / P(t-126) - 1
momentum_12m = P(t)     / P(t-252) - 1
momentum_12_1= P(t-21)  / P(t-252) - 1      ← headline "12–1 momentum"
volatility   = stdev(daily returns, 252) × √252
risk_adj     = decimal 12-1 return / daily return standard deviation
```

The cross-sectional Z-score is computed from risk-adjusted momentum over the eligible universe and
capped at ±3:

```
score = 1 + z          if z > 0
score = 1 / (1 - z)    if z < 0
score = 1              if z = 0
```

A symbol needs 253 valid adjusted-close observations for the full 12-1 window. Ten-month universe
eligibility and full momentum eligibility are reported separately.

## Portfolio

Top 100 by score, weighted by provider-supplied float-adjusted market cap × score, then
proportionally redistributed under a 9 % name cap and 35 % sector-group cap. Infeasible constraints
are reported rather than violated. Names without verified float shares are excluded.

## Backtest

Signals form at the last trading session of March and September, with execution at the next
available adjusted close. The research backtest uses equal weights because point-in-time
float-adjusted caps are unavailable; it applies 0.10 % transaction costs and 0% slippage. SPY and
SPMO use their own adjusted closes.

## Tests

```bash
npm run data:test        # unit tests
npm run data:verify      # live service integration checks
npm run data:audit       # cached-data quality evidence
npm run data:sensitivity # historical robustness checks
```

`verify.py` needs the service running. It checks: single as-of date, minimum history, no null or
NaN values, strict ranking order, momentum recomputed from raw bars, portfolio caps, backtest
sanity, and an AAPL price cross-check against Twelve Data.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DATA_SERVICE_PORT` | `8787` | port |
| `DATA_PROVIDER_CHAIN` | `yahoo,twelvedata,fmp` | failover order |
| `DATA_HISTORY_BATCH_SIZE` | `40` | symbols per primary batch |
| `DATA_HISTORY_BATCH_WORKERS` | `2` | concurrent primary batches |
| `DATA_SERIES_FETCH_WORKERS` | `4` | per-symbol recovery concurrency |
| `DATA_QUOTE_WORKERS` | `4` | quote metadata concurrency |
| `DATA_RETRY_ATTEMPTS` | `2` | transient retries per symbol |

The publication endpoint returns current data, marked stale cache while a rebuild is in progress,
or a lightweight warming payload when no cache exists. The browser never waits for a cold provider
scan before rendering the application shell.
| `DATA_HISTORY_YEARS` | `10` | history depth |
| `DATA_REQUEST_TIMEOUT` | `25` | per-request timeout (s) |
| `DATA_CACHE_DIR` | `data-service/cache` | cache location |
| `TWELVEDATA_API_KEY` | — | enables the verified backup |
| `FMP_API_KEY` / `ALPHAVANTAGE_API_KEY` / `FINNHUB_API_KEY` / `POLYGON_API_KEY` | — | optional |

Keys are read from the process environment or a git-ignored `.env` at the repository root. They are
never written to logs, API responses, or the browser bundle.

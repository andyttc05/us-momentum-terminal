# Data Pipeline and Deployment

## Production path

GitHub Pages is static hosting. Production therefore uses a validated JSON publication rather than a
runtime Python server.

```text
Yahoo Finance
  → Python provider cache
  → universe validation + momentum + score-only selection + square-root weighting + backtest
  → atomic static export
  → frontend/public/data
  → GitHub Pages artifact
  → browser publication + browser cache
```

The exporter is `data-service/scripts/export_static.py`. It reuses the same functions as FastAPI and
does not maintain a second set of calculations. `--write-seed` also refreshes
`data-service/seed/publication.json` from the identical payload, because the seed is what the API
serves before its first live build and must not describe an older weighting rule.

`PUBLICATION_VERSION` is bumped whenever the construction methodology changes. The static publisher,
the validator and the browser all compare it, so a visitor with a cached linear-weight publication is
sent to the new one instead of seeing old weights presented as current.

## Provider behavior

Yahoo Finance through `yfinance` is the default provider. It supplies adjusted daily bars, OHLCV,
dividends, splits and current quote metadata. Optional Twelve Data and FMP adapters require
server-side API keys. Stooq remains disabled because its anonymous export is blocked and it does not
provide adjusted closes.

Yahoo is an unofficial provider with no published service-level guarantee. The collection path:

- requests small serialized batches with a client-side rate limiter;
- retries transient failures with bounded exponential backoff;
- trims only incomplete trailing rows whose adjusted close has not yet been
  published;
- rejects interior adjusted-close gaps, short histories, and unadjusted series;
- retries omitted tickers through a separately bounded, rate-limited recovery
  pool and records each batch omission and recovery attempt;
- uses valid stale cached history when a live response is empty or truncated,
  while preventing a short response from replacing a longer valid cache;
- serializes detailed quote recovery to avoid Yahoo metadata rate limits;
- reuses verified float-share cache within `FUNDAMENTAL_FALLBACK_MAX_AGE`;
- records ticker-level failures instead of fabricating bars or fundamental values.

No CAPTCHA or access-control bypass is implemented. Provider keys remain server-side and are never
included in a browser request or static publication.

## Published files

| File | Purpose |
| --- | --- |
| `publication.json` | Snapshot, rankings, portfolio, charts and backtest series |
| `manifest.json` | Versions, timestamps, coverage and file sizes |
| `stocks/{TICKER}.json` | Full weekly price history, returns and rank history loaded on demand |

All files are written without indentation to reduce transfer size. The current initial publication
is about 3.8 MB and all stock details together are about 4.6 MB, because each detail file carries
every weekly observation the provider returned (up to ten years, 24–31 KB per ticker) so the chart
can offer 1M through ALL without a second request. A Stock Analysis page loads only its own detail
file. The four monthly/quarterly/semiannual/annual schedules for each portfolio are stored as separate
files under `backtests/` and load only when Run Backtest needs them. The exporter is being extended with `backtest-inputs.json` for daily adjusted and split-adjusted prices,
volumes, distributions, corporate actions, sectors and historical share disclosures. The static UI
currently keeps custom-date runs disabled until the JavaScript calculation port passes Python parity;
it does not fall back to a server request. The eight published schedule results remain available.

## Update schedule

`.github/workflows/deploy-pages.yml` runs:

- on every push to `main`, refreshing and validating data before deployment;
- weekdays at `22:23 UTC`, after the regular US market close;
- on manual dispatch.

Scheduled and manual builds restore the Python provider cache, refresh the publication, validate it,
build the static frontend and deploy the Pages artifact. A new publication is not committed by the
scheduled job; the deployed artifact receives the latest data.

Yahoo bars are requested in bounded, serialized batches with exponential backoff. A ticker omitted
from an otherwise successful batch is retried individually through the provider chain; the
publication records every failure and the exporter rejects an export unless all 200 requested price
series were loaded. Eligibility filters may still leave fewer than 200 eligible stocks, but a provider
omission is never accepted.

## Validation and rollback

The export is rejected when:

- the universe or publication version is stale;
- the provider is disconnected;
- any requested price series is missing, or fewer than 95% of requested stocks are eligible;
- either model portfolio or either backtest is unavailable;
- the market date is older than ten days;
- fewer than 98% of stock detail pages can be built;
- the manifest and publication disagree;
- a referenced stock detail file is missing.

The exporter writes into a temporary directory and swaps it into place only after validation. If a
provider fetch or validation fails, the existing snapshot remains untouched and the workflow skips
the Pages deployment. This keeps the currently deployed publication available instead of replacing
it with an older checkout copy.

Failure logs contain a `REFRESH_DIAGNOSTICS` JSON object generated from the
current run. It separates missing or invalid price history from universe
eligibility and portfolio investability, and includes the exact missing ticker
lists, exclusion categories, float-share coverage, provider attempts, and
portfolio construction reasons. Provider response headers and credentials are
never included.

## Browser freshness and fallback

`MarketProvider` uses this order:

1. Read the last valid publication from browser storage and render it immediately.
2. Revalidate the small same-origin `manifest.json` in the background.
3. Compare publication version, collection timestamp and market date.
4. Download `publication.json` only when that identity changed, then require its exact stock count,
   complete universe accounting, both model books and both backtests to match the manifest.
5. Write only a complete validated publication back to browser storage.
6. On failure, keep the last valid browser copy and label it cached.
7. In local live mode, use the same fallback around the FastAPI request.

The update pill opens **Data & Cache**, which displays:

- market data as-of date;
- last successful collection timestamp;
- data age and a stale marker after 72 hours;
- provider and connection status;
- current publication version;
- last visitor refresh attempt and its result;
- eligible stock count;
- browser cache timestamp;
- stock-detail count and backtest count for static builds.

## Request deduplication

Static requests share an in-flight request map. Repeated snapshot or stock requests reuse an already
pending promise instead of issuing duplicates. Static mode checks GitHub Pages every 15 minutes. A
manual **Check for updates** revalidates the manifest without replacing the visible publication when
its identity is unchanged. An optional **Refresh market data** action calls a separate authenticated
broker; the browser waits for the Pages publication identity to change before reporting **Updated**.
An accepted dispatch or unchanged JSON response alone never counts as an update.

Live diagnostics write to the git-ignored `data-service/docs/` directory. Provider probes, data-quality
audits, verification reports and sensitivity results are development evidence, not production data.

## Failure states

| State | Meaning |
| --- | --- |
| Published | A valid static snapshot loaded from GitHub Pages |
| Cached data | Last valid browser/service copy is visible after a failed update |
| Updating | A background check is running while existing data remains usable |
| Updated | A newer manifest-matching publication was applied after a requested refresh |
| Update failed | The last valid publication remains visible and the request or timeout is reported |
| Partial data | Some symbols failed validation |
| Unavailable | No valid publication or section is available |

No mock prices are substituted when data is unavailable.

## Static deployment operation

Pages configuration:

```text
Build command: npm run build
Environment:
  VITE_BASE_PATH=/us-momentum-terminal/
  VITE_DATA_MODE=static
```

Snapshot reads and backtest schedule selection remain static. The default semiannual backtest is in
the publication; monthly, quarterly and annual schedules are loaded from `backtests/` only when the
user runs them. Published schedule files include backend Strategy/SPY/SPMO cash-flow accounts. A
custom date window uses the API when available; the identical deterministic unit-account simulator
in the browser preserves cash-flow behavior when only static schedule data is available.

Backtesting's persisted Universe choice selects the universe for the *next* run. The publication
carries one dataset per universe (`datasets.top100`, `datasets.top20`); each dataset holds its own
selected tickers, model portfolio, Overview block and provenance. A successful backtest promotes its
universe to the active dataset, which is what Overview, Screener and Portfolio display, so a page can
never mix a Top 20 holding count with Top 100 momentum rows, sector weights or export rows. Switching
the selector without rerunning leaves the completed results labelled with the universe that produced
them and reports the difference through the shared notification card.

## Universe datasets

`build_universe_datasets` derives both datasets from the same verified publication:

| Field | Content |
| --- | --- |
| `universe` | `top100` or `top20` |
| `meta` | Universe, target holdings, selected count, calculation date, data timestamp, run id, portfolio/backtest status, methodology id, weighting method, market-cap exponent, constraint-validation state |
| `stockTickers` | The selection in rank order (the ranked rows live once in `stocks`) |
| `portfolio` | That universe's model portfolio — holdings, sectors, summary, constraints, selection rule, weighting metadata |
| `overview` | Snapshot counts, Top Momentum, sector allocation and performance for that universe |

Stock rows are resolved from the portfolio's own selection rather than sliced from the top of the
ranking, so the Screener record count, its pagination, the holdings table and every export describe the
same names. The legacy top-level `overview` mirrors the Top 100 dataset for older cached clients.

Validation rejects an export when a dataset is missing, lists a different number of stocks than its
target, disagrees with its own portfolio holdings, or has no performance series.


The workflow uses the official `actions/configure-pages`, `actions/upload-pages-artifact` and
`actions/deploy-pages` actions with OIDC permissions.

# Data Pipeline and Deployment

## Production path

GitHub Pages is static hosting. Production therefore uses a validated JSON publication rather than a
runtime Python server.

```text
Yahoo Finance
  → Python provider cache
  → universe validation + momentum + portfolio + backtest
  → atomic static export
  → frontend/public/data
  → GitHub Pages artifact
  → browser publication + browser cache
```

The exporter is `data-service/scripts/export_static.py`. It reuses the same functions as FastAPI and
does not maintain a second set of calculations.

## Published files

| File | Purpose |
| --- | --- |
| `publication.json` | Snapshot, rankings, portfolio, charts and backtest series |
| `manifest.json` | Versions, timestamps, coverage and file sizes |
| `stocks/{TICKER}.json` | Weekly price, returns and rank history loaded on demand |

All files are written without indentation to reduce transfer size. The current initial publication
is about 0.95 MB and all stock details together are about 1.2 MB. A Stock Analysis page loads only
its own detail file. The four monthly/quarterly/semiannual/annual schedules for each portfolio are
stored as separate files under `backtests/` and load only when Run Backtest needs them.

## Update schedule

`.github/workflows/deploy-pages.yml` runs:

- on every push to `main`, using the committed validated snapshot;
- weekdays at `22:23 UTC`, after the regular US market close;
- on manual dispatch.

Scheduled and manual builds restore the Python provider cache, refresh the publication, validate it,
build the static frontend and deploy the Pages artifact. A new publication is not committed by the
scheduled job; the deployed artifact receives the latest data.

## Validation and rollback

The export is rejected when:

- the universe or publication version is stale;
- the provider is disconnected;
- fewer than 95% of requested stocks are present;
- either model portfolio or either backtest is unavailable;
- the market date is older than ten days;
- fewer than 98% of stock detail pages can be built;
- the manifest and publication disagree;
- a referenced stock detail file is missing.

The exporter writes into a temporary directory and swaps it into place only after validation. If a
provider fetch or validation fails, the existing snapshot remains untouched. The workflow can still
deploy that previous valid snapshot; the published timestamps remain visible so it is never presented
as current.

## Browser freshness and fallback

`MarketProvider` uses this order:

1. Read the last valid publication from browser storage and render it immediately.
2. Fetch the current same-origin static publication in the background.
3. Write a valid response back to browser storage.
4. On failure, keep the last valid browser copy and label it cached.
5. In local live mode, use the same fallback around the FastAPI request.

The update pill opens **Data & Cache**, which displays:

- market data date;
- last successful collection timestamp;
- age of the publication;
- provider;
- eligible stock count;
- browser cache timestamp;
- stock-detail count and publication version for static builds.

## Request deduplication

Static and live API adapters share an in-flight request map. Repeated snapshot or stock requests
reuse an already pending promise instead of issuing duplicates. Static mode polls every 15 minutes;
live mode polls every 5 minutes. A manual "check for updates" bypasses the browser/request cache.

## Failure states

| State | Meaning |
| --- | --- |
| Published | A valid static snapshot loaded from GitHub Pages |
| Cached data | Last valid browser/service copy is visible after a failed update |
| Updating | A background check is running while existing data remains usable |
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
user runs them. Date-window slicing and account cashflow calculations happen in the browser from the
published daily series.

Backtesting's persisted Universe choice selects between the published `portfolios.top100` and
`portfolios.top20` books. Portfolio resolves all of its KPIs, allocation views, constraints and CSV
export from that same selected book. Switching Universe marks any previously displayed backtest as
outdated until the user reruns it.

The workflow uses the official `actions/configure-pages`, `actions/upload-pages-artifact` and
`actions/deploy-pages` actions with OIDC permissions.

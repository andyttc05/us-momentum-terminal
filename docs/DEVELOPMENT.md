# Development Guide

## Requirements

- Python 3.11 or newer
- Node.js 20 or newer
- npm
- Internet access for live market data

## Install

From the repository root:

```bash
npm run data:install
npm --prefix frontend ci
```

Python dependencies install into the git-ignored `.venv-datatest` directory. Frontend dependencies
install into `frontend/node_modules`.

## Run locally

Start the data service:

```bash
npm run data:serve
```

In a second terminal, start Vite:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to FastAPI on port `8787`.

To use the committed static publication without the Python service:

```bash
VITE_DATA_MODE=static npm --prefix frontend run dev
```

## Configuration

Copy `.env.example` to the git-ignored `.env` only when optional provider or runtime settings are
needed.

Common variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_DATA_MODE` | `live` in development, `static` in production | Select API or static JSON |
| `VITE_BASE_PATH` | `/` | GitHub Pages base path |
| `DATA_PROVIDER_CHAIN` | `yahoo,twelvedata,fmp` | Provider preference order |
| `DATA_HISTORY_YEARS` | `10` | Requested price history |
| `DATA_TTL_SNAPSHOT` | `900` | Publication cache lifetime in seconds |
| `DATA_TTL_BARS_INTRADAY` | `900` | Open-market bar cache lifetime |
| `DATA_TTL_BARS_CLOSED` | `21600` | Closed-market bar cache lifetime |
| `DATA_TTL_META` | `86400` | Quote-metadata cache lifetime |
| `DATA_CACHE_DIR` | `data-service/cache` | Cache directory override |

Provider keys belong only in local environment variables or private server-side secrets. They must
never be added to frontend build variables.

## Tests

```bash
npm run data:test
npm run test:frontend
npm run test:sites
npm run build
```

Additional verification:

```bash
npm run data:validate-static
npm run data:verify
npm run data:audit
```

The provider probe makes real network requests and is intentionally outside normal CI:

```bash
npm run data:probe
```

## Static publication

```bash
npm run data:build-static
npm run data:validate-static
```

The exporter stages a complete publication under `frontend/public/data/`:

```text
manifest.json
publication.json
stocks/{TICKER}.json
backtests/{portfolio}/{frequency}.json
backtest-inputs.json
```

Only a fully validated staging directory replaces the existing publication. If provider collection or
validation fails, the previous snapshot remains intact.

To also refresh the API seed:

```bash
npm run data:build-static -- --write-seed
```

## Frontend structure

| Path | Responsibility |
| --- | --- |
| `frontend/src/api/client.js` | Static/live adapter and request deduplication |
| `frontend/src/api/MarketProvider.jsx` | Publication, cache, refresh, and fallback state |
| `frontend/src/api/UniverseProvider.jsx` | Top 20 / Top 100 dataset selection |
| `frontend/src/components/` | Shared cards, charts, navigation, dialogs, and states |
| `frontend/src/styles/` | Tokens and shared/page styles |
| `frontend/src/utils/` | Calculations, formatting, and chart helpers |
| `frontend/src/*Page.jsx` | Overview, Screener, Portfolio, Backtesting, Stock Analysis |

All pages stay inside the same shell. Data-dependent sections use shared loading, empty, and error
states; the whole page is never replaced by a spinner.

## Local API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service, cache, and provider state |
| GET | `/api/snapshot` | Publication |
| GET | `/api/stock/{ticker}` | Stock detail and history |
| GET | `/api/bars/{ticker}` | Normalized daily bars |
| POST | `/api/backtest` | Date- and schedule-bounded backtest |
| GET | `/api/providers` | Provider configuration |
| GET | `/api/probe` | Last recorded provider probe |
| GET | `/api/config` | Non-secret runtime configuration |
| POST | `/api/provider` | Select and verify a provider |
| POST | `/api/refresh` | Start a forced background refresh |

## Production

GitHub Pages is the production host. `.github/workflows/deploy-pages.yml` runs on pushes to `main`,
on a weekday schedule, and by manual dispatch. It runs tests, refreshes and validates market data,
builds the React application, and deploys the Pages artifact.

Required production build settings:

```text
VITE_BASE_PATH=/us-momentum-terminal/
VITE_DATA_MODE=static
```

The optional secure refresh broker is documented in [REFRESH_BROKER.md](REFRESH_BROKER.md). GitHub
credentials are never present in frontend code.

See [DATA_PIPELINE.md](DATA_PIPELINE.md) for validation, rollback, schedules, and browser-cache
behavior.

# Frontend

React 19 and Vite 6 single-page application for US Momentum Terminal.

## Data modes

- `VITE_DATA_MODE=live` (default in development): Vite proxies `/api` to the FastAPI service.
- `VITE_DATA_MODE=static` (default in production): the app fetches `data/publication.json` and
  on-demand `data/stocks/{TICKER}.json` files from `public/`.

The last successful publication is also stored in browser storage, so a returning visitor sees valid
cached data immediately while the current snapshot is checked in the background.

## State handling

All five pages render their complete structural layout before data resolves. `DataState`,
`ChartState`, `KpiCard loading`, and shared table skeleton rows keep placeholders inside the original
cards and rows. A section is considered:

- `loading` only while no valid data for that section exists;
- `ready` as soon as current or cached data can be rendered;
- `error` after a request settles without valid data;
- `empty` after a successful response contains no section data.

Screener controls, table headings and pagination remain available during loading. Portfolio
constraints remain “Not evaluated” until a valid holdings book exists. Backtesting keeps its KPI,
chart, drawdown, annual-return and performance-summary structures mounted in every state.

Backtesting's Universe selector writes `top100` or `top20` to the shared `UniverseProvider`. The
selection is persisted under `umt:universe:v1`, restored on refresh and read by Portfolio, which has
no selector of its own. Portfolio resolves the matching published book by the selected count, so its
holdings, KPIs, allocation, constraints and CSV export cannot drift from another universe.

## Run

From the repository root:

```bash
npm --prefix frontend ci
npm run data:serve
npm run dev
```

Static-only frontend:

```bash
VITE_DATA_MODE=static npm --prefix frontend run dev
```

Production build:

```bash
npm run data:validate-static
VITE_DATA_MODE=static npm run build
```

The generated site is under `dist/client/`. GitHub Pages uses
`VITE_BASE_PATH=/us-momentum-terminal/`.

## Structure

| Path | Role |
| --- | --- |
| `src/api/client.js` | Live/static request adapter and request deduplication |
| `src/api/MarketProvider.jsx` | Shared snapshot state, background refresh and browser fallback |
| `src/api/UniverseProvider.jsx` | Shared persisted Top 100 / Top 20 selection |
| `src/api/dataCache.js` | Bounded browser cache access |
| `src/components/DataStatusDialog.jsx` | Data freshness and cache details |
| `public/data/` | Published static market-data snapshot |
| `src/*Page.jsx` | Overview, Screener, Portfolio, Backtesting and Stock Analysis |
| `src/components/` | Shared cards, charts, navigation, tables and data states |
| `src/styles/` | Design tokens, shared components, layout and page styles |

## Commands

```bash
npm run test:unit
npm run test:sites
npm run build
```

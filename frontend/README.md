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

Screener, Portfolio and Backtesting share one `ExportMenu`. It lists exactly two formats — Excel
Workbook (.xlsx) and CSV (.csv) — in a compact two-row popover. CSV exports preserve the complete
result set, not only the visible page. Excel workbooks include the relevant results, settings and
methodology sheets; the workbook libraries load only when an Excel export is requested. The Screener
renders its trigger through the same `AppButton` used by Filters, so the two toolbar pills cannot
drift apart in size or state.

`UniverseProvider` keeps two values apart: the universe selected for the next Backtesting run
(`umt:universe:v1`) and the active dataset universe (`umt:active-universe:v1`). Overview, Screener and
Portfolio resolve `datasetForUniverse(data, activeUniverse)` and read the selected tickers, portfolio,
holding count, sector split, Top Momentum, performance and export rows from that one dataset. A
successful backtest activates its own universe; the Screener toolbar switch activates a dataset
app-wide. Editing the Backtesting selector alone never relabels completed results — the mismatch is
reported through the shared black notification card.

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

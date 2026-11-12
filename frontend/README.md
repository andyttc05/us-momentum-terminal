# Frontend

React 19 and Vite 6 single-page application for US Momentum Terminal.

## Run

From the repository root:

```bash
npm run data:serve
npm run dev
```

The Vite development server proxies `/api` to `http://127.0.0.1:8787`. Use
`VITE_API_BASE_URL=https://us-momentum-data.onrender.com/api` to build against the hosted API.

## Structure

| Path | Role |
| --- | --- |
| `src/App.jsx` | Application shell and mounted page composition |
| `src/router.jsx` | History API routing and stock navigation |
| `src/api/client.js` | Timeout-aware API wrapper |
| `src/api/MarketProvider.jsx` | Shared snapshot state, refresh and provider selection |
| `src/*Page.jsx` | Overview, Screener, Portfolio, Backtesting and Stock Analysis |
| `src/components/` | Shared cards, charts, navigation, tables, status and project information |
| `src/styles/` | Design tokens, shared components, layout and page CSS |
| `worker/index.js` | Optional Sites SPA fallback worker |

## Data Contract

The frontend consumes `GET /api/snapshot` for:

- `meta`: provider, market date, timeliness, cache and refresh state.
- `universe`: scan and exclusion counts.
- `stocks`: rankings, momentum metrics, market data and provenance.
- `overview`: KPI values, performance series, top momentum and sector allocation.
- `portfolio`: holdings, weights, constraints and allocation.
- `backtest`: metrics, daily series, drawdown and annual returns.

`GET /api/stock/{ticker}` adds weekly price history and month-end rank history.

## UI Rules

- Preserve the established dashboard design language.
- Never display fabricated market values.
- Render missing values as `—`.
- Keep data status distinct from a general application error.
- Keep provider credentials out of the browser.
- Preserve responsive navigation and horizontally scrollable tables.

## Tests

```bash
npm run test:unit
npm run build
npm run test:sites
```

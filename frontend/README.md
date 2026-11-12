# US Momentum Terminal — Frontend

React 19 + Vite 6 single-page terminal for a US equity momentum strategy. All prices, volumes,
market caps and corporate actions come from live provider data through the local data service.
There is no mock data in this bundle: if the service cannot verify a number, the UI shows `—`.

## Run

```bash
# 1. data service (repo root)
npm run data:serve          # FastAPI on :8787, proxies to Yahoo Finance

# 2. UI
npm run dev                 # or npm run preview (serves dist/)
```

`vite.config.mjs` proxies `/api` → `http://127.0.0.1:8787` for both `dev` and `preview`.
Use `DATA_SERVICE_URL=http://127.0.0.1:8788 npm run preview` to point at another instance.

## Structure

| Path | Role |
|---|---|
| `src/api/client.js` | fetch wrapper: timeouts, friendly transport errors |
| `src/api/MarketProvider.jsx` | single snapshot fetch shared by every page, 5-minute revalidation, manual refresh |
| `src/components/UpdateBar.jsx` | shared freshness state and refresh control |
| `src/components/StatusToast.jsx` | provider or refresh error surface |
| `src/*Page.jsx` | Overview, Screener, Stock Analysis, Portfolio, Backtesting |

## Data contract

`GET /api/snapshot` returns:

* `meta` — provider, as-of date, timeliness (`realtime` / `delayed` / `end-of-day`), session state,
  backup flag, warnings, provider health
* `stocks` — one row per verified symbol: price, 1D change, 1m/3m/6m/12m and 12–1 momentum,
  volatility, risk-adjusted momentum, z-score, score, rank, market cap, sparkline, source
* `overview` — snapshot counts, top momentum, sector allocation (portfolio weights), performance
  curves for 1Y/3Y/5Y/All
* `portfolio` — 100 holdings with raw and capped weights, sector totals, constraint checks
* `backtest` — daily NAV for the top-100 and top-20 % books, drawdowns, annual returns

`GET /api/stock/{ticker}` adds the weekly price series and the month-end rank/score history.

## UI rules that must not regress

* Design, layout, typography, colours, spacing and interactions stay as approved — only the data
  behind them changed.
* No placeholder or demo values anywhere. Missing data renders as `—`, never as a plausible number.
* The update bar reflects the shared fetch state on desktop.
* Provider identity, market-data date and timeliness travel in `meta`; detailed status is available
  from the data-service API.

## Tests

From the repository root, `npm run build` (Vite + Sites preparation) and `npm run test:sites` must
pass. Data-layer checks live in `../data-service/tests/`.

# Data Service

The Python pipeline retrieves and validates US market data, calculates momentum and portfolio
weights, runs historical backtests, serves the optional FastAPI endpoints, and exports the static
publication used by GitHub Pages.

## Run locally

From the repository root:

```bash
npm run data:install
npm run data:serve
```

The service listens on `http://127.0.0.1:8787`. Vite proxies `/api` to this address in live mode.

## Static publication

```bash
npm run data:build-static
npm run data:validate-static
```

The exporter writes compact JSON to `frontend/public/data/`:

```text
publication.json
manifest.json
stocks/{TICKER}.json
```

It validates the provider connection, at least 95% universe coverage, both 100- and 20-holding model
portfolios, both backtests and on-demand stock details. Files are staged and only replace the live
directory after
validation passes. A failed update preserves the previous valid snapshot.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service, cache and provider state |
| GET | `/api/snapshot` | Complete current publication |
| GET | `/api/stock/{ticker}` | Stock detail and price/rank history |
| GET | `/api/bars/{ticker}?days=N` | Normalized daily bars |
| POST | `/api/backtest` | Date-bounded backtest with selected rebalance frequency |
| GET | `/api/providers` | Provider roles and availability |
| GET | `/api/probe` | Last recorded provider probe |
| GET | `/api/config` | Non-secret runtime configuration |
| POST | `/api/provider` | Select a provider and rebuild the publication |
| POST | `/api/refresh` | Run a forced background refresh |

## Providers

Yahoo Finance through `yfinance` is the default source. It supplies adjusted daily bars, dividends,
splits and current quote/fundamental metadata. The optional Twelve Data and FMP adapters require
server-side keys; keys are never returned to the browser.

The provider probe in `tests/provider_probe.py` performs real network requests and writes
`docs/provider_probe.json`. On 13 November 2026, Yahoo returned complete data for all 20 sampled
symbols. Twelve Data's public demo key returned 2 of 20 symbols. FMP, Alpha Vantage, Finnhub and
Polygon were reachable but require keys. Stooq was unavailable.

Yahoo is unofficial and must be paced. No CAPTCHA or access-control bypass is implemented.

## Cache behaviour

Atomic JSON files are stored in ignored `data-service/cache/`:

- provider bars and quote metadata;
- derived rank history;
- publication and stock-detail projections;
- CPI-U observations.

The live API returns the last valid cached/seed payload while a refresh runs. Snapshot TTL is 15
minutes, intraday bars 15 minutes, closed-market bars 6 hours and quote metadata 24 hours.

## Analytics

- 12–1 momentum, 252-session daily volatility, risk-adjusted momentum and clipped Z-scores.
- Top 100 or exactly Top 20 ranked eligible stocks.
- Float-adjusted model portfolio with a 9% single-stock cap and a 35% sector-group cap.
- Rebalancing choices: monthly, quarterly, semiannual and annual.
- Historical strategies start from equal weights and apply the same stock/sector caps.
- Signals use the final trading session of the selected months; execution uses the next close.
- Transaction costs are 0.10%; slippage and risk-free rate are 0%.
- Adjusted-close and cash-dividend conventions remain separate.
- CPI-U inflation adjustment uses published observations only.

The historical universe, current constituents, current fundamentals and missing delisting returns
remain research limitations. See `../docs/TECHNICAL_DOCUMENTATION.md`.

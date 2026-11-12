# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Market data (durable decisions)

All market data comes from the local Python data service in `../data-service` (FastAPI on :8787, proxied by Vite via `/api`). Never reintroduce `src/data/*DemoData.js` — the demo fixtures were deleted on purpose.

- Primary provider: Yahoo Finance via yfinance; backups: Twelve Data (needs `TWELVEDATA_API_KEY`), Stooq, FMP. Order via `DATA_PROVIDER_CHAIN`.
- API keys live only in `.env` (git-ignored) and are read server-side. Nothing key-related may enter the bundle or a client request.
- The UI must never invent a value. Missing data renders `—`; charts render a "Waiting for verified price history…" placeholder.
- Momentum uses adjusted closes only, 21/63/126/252-session windows; `12–1` = P(t-21)/P(t-252)-1. Universe eligibility starts at 210 observations; scoring needs 253.
- Risk-adjusted momentum is the 12–1 decimal return divided by sample standard deviation of the trailing 252 daily returns. The cross-sectional Z-score is capped at ±3, then transformed by `score = 1 + z` for positive Z, `1 / (1 - z)` for negative Z, and `1` at zero.
- Portfolio raw weight is float-adjusted market cap × momentum score. Never substitute ordinary market cap for a missing float cap.
- The header `UpdateBar` is the user-visible freshness control. Provider identity and timeliness remain in data-service metadata and documentation.

From the repository root, run `npm run data:serve`, then `npm run dev` or `npm run preview`. Data checks: `npm run data:test` and `npm run data:verify`.


## Navigation (durable)

Routing is a small history-API router in `src/router.jsx` (no dependency): `/`, `/screener`, `/portfolio`, `/backtesting`, `/stock/:ticker`. Always navigate to a stock through `useStockNavigation()` / `stockPath(ticker)` — never build `/stock/...` strings by hand, so encoding and origin tracking stay in one place. Pages other than Stock Analysis stay mounted and toggle `hidden` so filters/search/sort/pagination survive a round trip.

## Update bar (durable)

The top-right pill is one component: `src/components/UpdateBar.jsx`. Never rebuild it per page — it renders the dot, label, date, divider and refresh button, and derives its state (`loading / updating / updated / failed / empty`) from `useMarket()` so the label and dot can't disagree with the request. Pages pass only `date` / `dateTime` overrides (Backtesting shows its window end) and an optional `onRefresh` for page-specific toast copy. Provider identity is intentionally absent from the bar; it lives in the service (`DATA_PROVIDER_CHAIN`, `POST /api/provider`).

## Pagination (durable)

`components/Pagination.jsx` + `styles/pagination.css` are shared by Screener and Portfolio. The active page is a per-button class — there is deliberately **no** shared/sliding indicator. `.is-current` is the only rule that transitions `background-color`, so the outgoing page clears in the same frame and two yellow circles can never overlap. Every slot (numbers and the ellipsis) is one button-width, which keeps the row's geometry identical across window compositions; changing the ellipsis width breaks that.

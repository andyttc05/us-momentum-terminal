# Technical Architecture — Proposed Implementation Blueprint

This document translates the source proposal and detailed system guide into an implementable architecture. The stack is a proposal from the source documents; changes should be justified and approved before implementation.

## 1. Architecture principles

- Local browser-based application, initially run on one desktop/laptop.
- Modular monolith, not microservices, for the MVP.
- Keep data ingestion, data validation, quantitative calculations, portfolio construction, persistence, API and frontend presentation independent.
- Keep business logic out of Flask route handlers.
- The frontend must call the local backend API; it must not call market-data providers directly.
- A provider abstraction must allow each source to be enabled, disabled, or replaced independently. The application must not depend on one website for every data type.
- Prefer public downloadable sources that do not require paid plans or API keys. A source requiring credentials or payment is not an assumed dependency and needs a separate Product Owner decision.
- Public visibility does not imply permission to automate access, store, or redistribute data. Each source adapter must have a documented access and usage basis before it is enabled.
- All calculations must be reproducible using an as-of date and methodology version.

## 2. Proposed stack

| Concern | Technology |
|---|---|
| Language | Python |
| Web server | Flask |
| Templates | Jinja2 / HTML |
| Frontend | CSS + vanilla JavaScript |
| Data manipulation | Pandas, NumPy |
| Market data | Replaceable source adapters; source selection is subject to `DATA_SOURCE_RESEARCH.md` and `OPEN_DECISIONS.md` |
| Storage | SQLite |
| ORM / DB access | SQLAlchemy recommended |
| Charts | TradingView Lightweight Charts |
| Scheduler | APScheduler after manual workflows work |
| Tests | Pytest |

Do not use a different stack without documenting the trade-off and getting approval.

## 3. Suggested repository layout

```text
US-Momentum-Terminal/
├── AGENTS.md
├── README.md
├── PROJECT_SPEC.md
├── UI_DESIGN.md
├── DEVELOPMENT_PLAN.md
├── requirements.txt
├── .env.example
├── .gitignore
├── app.py
├── config.py
├── frontend/
│   ├── templates/
│   └── static/
│       ├── css/
│       ├── js/
│       └── assets/
├── backend/
│   ├── __init__.py
│   ├── routes/
│   ├── services/
│   ├── models/
│   └── utils/
├── data/
│   ├── providers/
│   ├── collectors/
│   ├── processors/
│   └── validation/
├── quant/
│   ├── universe.py
│   ├── momentum.py
│   ├── ranking.py
│   ├── portfolio.py
│   ├── constraints.py
│   └── backtest.py
├── database/
│   ├── db.py
│   ├── schema/
│   └── migrations/
├── scheduler/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── scripts/
└── logs/
```

The agent may adjust exact folder names when creating the real codebase, but it must preserve the module boundaries.

## 4. Data-provider abstraction

Create a common interface, conceptually:

```python
class MarketDataProvider:
    def get_symbols(self, as_of_date=None): ...
    def get_daily_prices(self, symbols, start, end, price_basis): ...
    def get_company_profile(self, symbol): ...
    def get_share_count_observations(self, symbol, as_of_date=None): ...
    def get_public_float_observations(self, symbol, as_of_date=None): ...
```

Keep provider-specific parsing and errors inside adapters. Separate interfaces/adapters by data domain (universe snapshots, OHLCV, filings/fundamentals, and supplemental reference checks); a run may combine approved sources, but each stored field must preserve its provider and observation metadata. Do not assume one source supplies a complete authoritative security master, point-in-time fundamentals, or all float data needed for unbiased backtesting.

The initial provider is not yet selected. Current research found that Yahoo's terms prohibit automated collection without prior permission; Stooq's historical CSV endpoint returned a JavaScript verification page in a direct request test; DeltaScreener publishes a dated CSV with stated attribution conditions; and SEC's public data APIs are keyless but require fair-access compliance and a declared user agent. Details and test outcomes are in `DATA_SOURCE_RESEARCH.md`. Do not implement automated Yahoo/Stooq/third-party site scraping unless the applicable source authorizes it.

## 5. Data update pipeline

Do not download all history on every page load. Use a controlled incremental process:

1. Load active ticker list.
2. Find the latest stored trading date per ticker.
3. Request only missing dates, with a small overlap if needed to catch corrections.
4. Validate rows and corporate-action adjustments.
5. Upsert successful data.
6. Update shares-outstanding, public-float, float-share, and market-cap observations separately, preserving both the period/effective date and the date the information became publicly available.
7. Run rankings only if the required data batch passes validation.
8. Log failed tickers and partial provider failures.

Use batch requests, retry/backoff for transient errors and a US market calendar where possible.

## 6. Data quality checks

- Unique `(ticker, date)` price rows.
- Non-null, positive price values.
- Non-negative volume.
- Unexpected jumps that may indicate split/corporate-action issues.
- Missing trading sessions.
- Stale market-cap or float data.
- Shares or float observations used before their filing/publication date (look-ahead leakage).
- Ticker changes and delistings where available.
- Provider errors, rate limits and incomplete download batches.

Do not publish a ranking as fully current if the data batch is incomplete. Return a health/status summary.

## 7. Proposed SQLite schema

The following is the starting model from the project guide. Add constraints and indexes where appropriate.

### `securities` / `security_symbols`

- `security_id` (stable internal primary key)
- `company_name`
- `exchange`
- `security_type`
- `sector`
- `listing_date`
- `is_active`
- `country_of_domicile`
- `updated_at`

Keep ticker/provider symbols in a history table with effective dates; do not use ticker as the only durable identifier because tickers can change or be reused.

### `daily_prices`

- `ticker`
- `date`
- `open`, `high`, `low`, `close`
- `adjusted_close` only with provider-defined adjustment semantics
- `price_basis` (raw, split-adjusted, or dividend-adjusted/total-return)
- `volume`
- `provider`
- `source_symbol`
- `source_as_of`
- `downloaded_at`
- `normalization_version`

Use a unique/composite primary key on `(ticker, date)`.

### `fundamentals`

- `ticker`
- `period_end` / `effective_date` (date the reported quantity refers to)
- `filed_at` / `known_at` (date/time the observation became available to the strategy)
- `shares_outstanding`
- `public_float_value` (SEC-reported aggregate market value of equity held by non-affiliates; a currency amount, not a share count)
- `public_float_shares` (only where a source actually reports a share quantity)
- `free_float_factor` (only where source methodology supports it)
- `float_shares` (derived only from an explicitly documented float-share observation or method)
- `total_market_cap`
- `float_adjusted_market_cap`
- `sector`
- `provider`
- `source_document` / `accession_number` where applicable
- `methodology` / `quality_status`

Retain immutable point-in-time observations; do not overwrite historical fundamentals required for backtesting. Never use today's shares outstanding for a historical date without labeling the resulting market cap as look-ahead biased and excluding it from an unbiased backtest.

Use distinct concepts and field names:

- **Total market capitalisation:** price × total shares outstanding for the chosen share classes and price timestamp.
- **Shares outstanding:** all issued shares treated as outstanding under the source's definition; it is not public float.
- **Public float:** SEC-reported market value of equity held by non-affiliates for a defined measurement date; the common SEC `EntityPublicFloat` XBRL fact is denominated in USD, not shares.
- **Float shares:** the share count considered publicly available/investable by a specified float methodology; do not infer it from a public-float dollar value unless the exact valuation price/date and methodology are known.
- **Float-adjusted market capitalisation:** price × float shares (or total market cap × an explicit, point-in-time free-float factor).

Initial price-history bootstrap should fetch approximately 14 months so the primary standard 12–1 calculation has a buffer for month-end session mapping and missing/revised rows. A valid momentum observation still requires the specified approximately 13-month interval and sufficient daily returns; the proposed 13-month universe-history minimum awaits final approval.

For SEC access, send an identifying User-Agent, remain within current Fair Access limits, and stage/cache bulk data where appropriate. A filing fact is only available to the strategy from its filing/known date, even when its measurement period ends earlier.

### `momentum_snapshots`

- `as_of_date`
- `ticker`
- `momentum_value`
- `lookback_type`
- `daily_volatility`
- `risk_adjusted_momentum`
- `z_score_raw`
- `z_score_capped`
- `momentum_score`
- `rank`
- `eligible`
- `exclusion_reason`
- `calculation_version`

### `portfolio_rebalances`

- `rebalance_id`
- `reference_date`
- `effective_date`
- `selection_mode`
- `number_of_holdings`
- `methodology_version`
- `created_at`

### `portfolio_holdings`

- `rebalance_id`
- `ticker`
- `momentum_score`
- `float_market_cap`
- `raw_weight`
- `final_weight`
- `sector`

### `backtest_runs` / `backtest_metrics`

Store start/end date, starting capital, universe, selection rule, rebalance frequency, cost/slippage assumptions, benchmarks and all key metrics.

### `system_logs`

Store job start/end, provider status, fetched/failed counts, skipped tickers, errors and calculation status.

### Suggested indexes

- `daily_prices(date, ticker)`
- `daily_prices(ticker, date)`
- `momentum_snapshots(as_of_date, rank)`
- `portfolio_holdings(rebalance_id, ticker)`

## 8. Flask pages and API shape

### HTML routes

| Route | Page |
|---|---|
| `/` | Overview |
| `/screener` | Screener |
| `/stock/<ticker>` | Stock Analysis |
| `/portfolio` | Model Portfolio |
| `/backtesting` | Backtesting |
| `/settings/stock` | Stock Settings |
| `/settings/portfolio` | Portfolio Settings |
| `/settings/backtest` | Backtest Settings |
| `/settings/general` | General Settings |

### JSON API (initial suggestion)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/overview` | GET | KPI and overview data |
| `/api/screener` | GET | Ranked securities, filters and pagination |
| `/api/stocks/<ticker>` | GET | Profile, price history and momentum metrics |
| `/api/portfolio/current` | GET | Current model portfolio |
| `/api/portfolio/history` | GET | Historical rebalance/weight history |
| `/api/backtest/latest` | GET | Latest backtest results |
| `/api/system/status` | GET | Last update and data health |
| `/api/settings` | GET/PUT | Read/update settings (split by category if preferred) |
| `/api/admin/refresh` | POST | Manually trigger local/admin refresh |

Use validation, typed schemas or equivalent response contracts. Do not let the frontend call the market-data provider directly. Keep API responses independent of visual components.

## 9. Automation

Use APScheduler only after manual collection, calculation and rebalance flows are stable.

- Daily: fetch data, validate, store, calculate ranking snapshot, update status.
- Semiannual: calculate and persist the official model portfolio in March and September according to the configured trading calendar/effective-date convention.
- Add job locks to prevent overlapping refreshes.
- Log errors and expose failed status in the dashboard.

## 10. Local runtime

The source guide suggests a local Python environment, Flask app and a local SQLite database. A typical start command is:

```bash
python app.py
```

The actual run command, host/port and migration/bootstrap steps must be recorded in the codebase README once implemented.

## 11. Security and operations

- API credentials in `.env`, never in frontend JavaScript or source control.
- Provide `.env.example` without real secrets.
- Validate settings on save.
- Do not allow a browser endpoint to trigger unrestricted expensive provider jobs; protect local/admin refresh routes.
- Log errors without leaking API secrets.
- Back up SQLite data before schema migrations.

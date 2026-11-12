# US Momentum Terminal

US Momentum Terminal is a local web application for studying a US equity momentum strategy. It
combines a React dashboard with a Python market-data service that retrieves prices, calculates
momentum metrics, ranks stocks, builds a model portfolio and runs a historical simulation.

The project is intended for students, project evaluators and developers who need a transparent view
of the strategy and its data. It is not a live trading system and it does not provide investment
advice.

## What The Application Does

- Screens US common stocks by 12-1 momentum and risk-adjusted momentum.
- Shows the current ranking, price history, volatility, Z-score and momentum score.
- Builds a hypothetical 100-stock model portfolio with name and sector constraints.
- Compares a historical momentum book with SPY and SPMO.
- Exports stock and portfolio data to CSV.
- Shows the data provider, market-data date and update status so missing or delayed data is visible.

The main pages are Overview, Screener, Portfolio, Backtesting and Stock Analysis.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 6, `@vitejs/plugin-react` |
| Styling | Plain CSS with a shared design-token layer (`frontend/src/styles/tokens.css`) |
| Icons | Phosphor Icons (`@phosphor-icons/react`) |
| Data service | Python 3.11+, FastAPI, Uvicorn |
| Market data | `yfinance` (Yahoo Finance) with Stooq, Twelve Data, FMP, Alpha Vantage and Finnhub as optional backup providers |
| Data processing | pandas, NumPy, `exchange-calendars` |
| Tests | Python `unittest` for the data service, `node:test` for the frontend and edge worker |

## How The Strategy Works

1. Start from the curated US equity universe in the data service.
2. Keep common stocks listed on NYSE, NASDAQ or NYSE American, priced at least $5, with at least
   210 trading observations and a three-month average daily dollar volume of at least $2 million.
3. Calculate 12-1 momentum from adjusted closing prices.
4. Divide that return by the trailing daily volatility to obtain risk-adjusted momentum.
5. Convert risk-adjusted momentum to a cross-sectional Z-score.
6. Cap the Z-score between -3 and +3.
7. Convert the capped Z-score to a Momentum Score.
8. Rank eligible stocks from highest to lowest score.
9. Select the top 100, or the top 20% of the currently eligible universe.
10. Multiply float-adjusted market capitalization by Momentum Score to obtain each raw portfolio
    weight.
11. Redistribute the weights under a 9% stock cap and a 35% sector-group cap.
12. Form historical signals at the end of March and September and execute at the next session.
13. Compare historical results with SPY and SPMO over the same dates.

## Key Formulas

All momentum calculations use adjusted closing prices.

### 12-1 Momentum

```text
M = Price(t - 21 sessions) / Price(t - 252 sessions) - 1
```

The most recent 21 trading sessions are excluded. The calculation uses the full prices from
approximately 13 months ago to approximately one month ago.

### Daily Volatility

```text
sigma_daily = sample standard deviation of the trailing 252 daily returns
annualized volatility (%) = sigma_daily * sqrt(252) * 100
```

The volatility displayed on the Stock Analysis page is annualized. The risk adjustment uses the
daily standard deviation as its denominator.

### Risk-Adjusted Momentum

```text
R = decimal 12-1 return / sigma_daily
```

The calculation is performed only when volatility is positive and finite.

### Cross-Sectional Z-Score

```text
z_i = (R_i - mean(R)) / population standard deviation(R)
z_i = min(3, max(-3, z_i))
```

Only stocks that pass the eligible universe and full momentum-history checks enter the
cross-section.

### Momentum Score

```text
Score = 1 + z          when z > 0
Score = 1 / (1 - z)    when z < 0
Score = 1              when z = 0
```

A higher score means a better momentum rank.

### Raw Portfolio Weight

```text
Raw Weight_i = Float-Adjusted Market Cap_i * Score_i
Normalized Raw Weight_i = Raw Weight_i / sum(all Raw Weights) * 100
```

Float-adjusted market cap is calculated from the provider's current float-share count multiplied by
the latest stock price. Ordinary company market cap is displayed separately in the Screener and
Stock Analysis pages.

### Final Portfolio Weight

The preliminary weights are scaled proportionally until they sum to 100%, while no position may
exceed 9% and no displayed sector group may exceed 35%. The implementation uses a capped
proportional redistribution solved by bisection. If the constraints cannot be met, the portfolio is
marked unavailable instead of publishing weights that break a limit.

## Portfolio Rules

- Maximum individual stock weight: 9%.
- Maximum displayed sector-group weight: 35%.
- Target holdings: 100.
- Fully invested: 100%.
- Rebalance months: March and September.
- Daily ranking updates do not create daily portfolio trades.

The dashboard's sector display groups Consumer Discretionary with Consumer Staples, and groups
Financials, Energy, Materials, Utilities and Real Estate under "Others". The 35% cap applies to
those displayed groups. This is a stricter grouping than a full 11-sector GICS allocation.

## Backtesting Method

The historical simulation is a research proxy for the ranking method. It does not reproduce every
part of the current portfolio model.

- Signals use data available at the last trading session of March or September.
- Trades execute at the next available adjusted close, which avoids using a signal at an earlier
  price.
- Holdings are marked to market daily between rebalances.
- The historical book is equal-weighted because point-in-time float-adjusted market caps are not
  available from the current data source.
- Transaction costs are 0.10% of traded buy and sell notional.
- Slippage is 0.00%.
- SPY and SPMO use adjusted closes over the same dates.
- Sharpe Ratio assumes a 0% risk-free rate. The rate is stored in the result payload.
- Annualized turnover is reported with the backtest metrics.

The backtest is not a point-in-time universe reconstruction. It starts from the current curated
stock list, so delisted, acquired or previously unlisted companies are handled only where their
history remains available. See [Strategy Validation](docs/STRATEGY_VALIDATION_REPORT.md) for the
full reliability assessment.

## Application Features

### Overview

Shows the scanned, eligible and portfolio stock counts; performance versus SPY and SPMO; the current
top momentum names; and sector allocation.

### Screener

Shows Top 100 and Top 20% views, search, filters, sorting, pagination and CSV export. The table's
rank stays the strategy rank when the user sorts by another column.

### Portfolio

Shows the 100-stock model portfolio, sector allocation, largest positions, constraint status and a
complete holdings export.

### Backtesting

Allows the user to select Top 100 or Top 20%, a date window and a 1Y/3Y/5Y/All chart range. It shows
cumulative return, CAGR, Sharpe Ratio, drawdown, annual returns and turnover calculations stored in
the service payload.

### Stock Analysis

Shows the stock's price summary, adjusted price chart, monthly returns, momentum metrics, rank tier
and month-end ranking history.

## Installation And Usage

### Requirements

- Python 3.11 or later.
- Node.js 20 or later and npm.
- Internet access for the market-data provider.

The repository includes package lockfiles. No API key is required for the default Yahoo Finance
provider. Optional backup keys may be added in `.env`.

### Install

```bash
npm run data:install
npm --prefix frontend install
```

`npm run data:install` creates `.venv-datatest` and installs `data-service/requirements.txt`.

### Environment

Copy `.env.example` to `.env` if optional keys are needed:

```bash
cp .env.example .env
```

Never commit `.env`. The browser never receives provider keys.

### Start

Run the data service in one terminal:

```bash
npm run data:serve
```

Run the frontend in another terminal:

```bash
npm run dev
```

The Vite development server is normally available at `http://127.0.0.1:5173/`. The data service
listens on `http://127.0.0.1:8787/`.

### Production Build And Preview

```bash
npm run build
npm run preview
```

The frontend build is written to `frontend/dist/`.

### Tests

```bash
npm run data:test
npm run test:sites
npm run build
```

With the data service running:

```bash
npm run data:verify
npm run data:audit
npm run data:sensitivity
```

Generated evidence is stored in `data-service/docs/`.

## Project Structure

```text
US_Momentum_Terminal/
├── README.md
├── package.json
├── .env.example
├── data-service/
│   ├── app/
│   ├── tests/
│   ├── cache/              # ignored runtime cache
│   └── docs/               # generated audit evidence
├── frontend/
│   ├── src/
│   ├── tests/
│   ├── worker/
│   └── package.json
└── docs/
    ├── DATA_AUDIT_REPORT.md
    ├── STRATEGY_VALIDATION_REPORT.md
    ├── PROJECT_TECHNICAL_DOCUMENTATION.md
    ├── FINAL_VALIDATION_REPORT.md
    ├── PRODUCT_UI_AUDIT.md
    ├── audit-screenshots/
    ├── development-history/
    └── source-brief/
```

## Important Limitations

- The investable list is a curated 109-ticker universe, not a complete daily scan of every US
  common stock.
- The provider is Yahoo Finance through an unofficial `yfinance` client.
- Current market cap and float shares are not point-in-time historical fundamentals.
- The backtest uses equal weights rather than the live portfolio's float-cap weighting.
- The current universe introduces survivorship and selection limitations in historical tests.
- Per-bar dividend and split fields are absent from the existing cached batch data even though
  adjusted closes are present.
- Cross-provider confirmation without paid backup keys is limited to public demo symbols.
- The Sharpe Ratio uses a 0% risk-free assumption.
- A historical result is not evidence of future returns or investment suitability.

The detailed source inventory, verification evidence and unresolved issues are in
[Data Audit](docs/DATA_AUDIT_REPORT.md) and
[Strategy Validation](docs/STRATEGY_VALIDATION_REPORT.md).

## Documentation

- [Project Technical Documentation](docs/PROJECT_TECHNICAL_DOCUMENTATION.md) — architecture, modules and API shape.
- [Data Audit Report](docs/DATA_AUDIT_REPORT.md) — source inventory, coverage and data quality evidence.
- [Strategy Validation Report](docs/STRATEGY_VALIDATION_REPORT.md) — reliability assessment of the momentum method and backtest.
- [Final Validation Report](docs/FINAL_VALIDATION_REPORT.md) — end-to-end validation results.
- [Product UI Audit](docs/PRODUCT_UI_AUDIT.md) — interface and responsive review.
- [Data Providers](data-service/docs/DATA_PROVIDERS.md) — provider chain, configuration and failover behaviour.
- [Data Service README](data-service/README.md) — service-level detail and API reference.
- [Frontend README](frontend/README.md) — frontend structure and component notes.
- [Source Brief](docs/source-brief/README_AGENT_START_HERE.md) — original requirements, methodology and design blueprint.
- [Development History](docs/development-history/README.md) — chronological record of the development and QA passes.

## License

The project's original code and documentation are distributed under the [MIT License](LICENSE).

Copyright (c) 2026 US Momentum Terminal contributors.

The MIT License covers original project material only. It does not cover
third-party market data, third-party libraries, fonts, icons or other
third-party assets, which remain subject to their own original licenses and
terms of use. The MIT License grants no permission to redistribute restricted
financial data.

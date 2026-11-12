# Project Brief — US Momentum Terminal

## 1. Product summary

US Momentum Terminal is a local web-based quantitative stock screening and simulated portfolio management application for US equities. It is inspired by the Invesco S&P 500 Momentum ETF (SPMO) and the S&P Momentum methodology, but it is **not an exact replication of SPMO**.

The product scans a defined universe of US-listed common stocks, removes ineligible or illiquid securities, calculates risk-adjusted price momentum, ranks the eligible securities, and constructs a hypothetical portfolio whose raw weights are based on float-adjusted market capitalization multiplied by Momentum Score.

The product must keep two calculations separate:

1. **Stock ranking:** which eligible securities have the strongest momentum?
2. **Portfolio construction:** how should hypothetical capital be allocated across the selected securities?

A high momentum rank does not necessarily mean a high portfolio weight. Market capitalization and portfolio constraints also affect the final weight.

## 2. Intended product capabilities

- US common-stock universe and eligibility screening.
- Daily market-data collection and validation.
- 12–1 month risk-adjusted momentum calculations.
- Cross-sectional Z-score and Momentum Score.
- Top 100 and Top 20% selection modes.
- Model portfolio weighting with stock and sector constraints.
- Overview dashboard, screener, portfolio, backtesting and contextual stock analysis.
- Four Settings sub-pages: Stock, Portfolio, Backtest and General.
- Historical ranking and portfolio-rebalance records.
- Benchmark comparison against SPY and SPMO.
- Daily ranking refresh and semiannual official portfolio rebalancing.

## 3. Core user questions

- Which stocks currently have the strongest risk-adjusted momentum?
- What are the momentum rank, score and relevant market characteristics of a selected stock?
- How would the model allocate a hypothetical portfolio across selected securities?
- Does the strategy outperform SPY and SPMO historically after reasonable assumptions and costs?
- What data and methodology were used to produce each result?

## 4. Operating model

### Daily ranking scan

After each US trading session, refresh available data, validate it, calculate updated momentum metrics, and publish a new ranking snapshot. The ranking may change every day.

### Semiannual model portfolio rebalance

The official model holdings and weights are recalculated on the scheduled March and September rebalance cycle. Daily ranking movements do **not** automatically trigger trades or replace official holdings between rebalance dates.

Between rebalances, the model portfolio is marked to market using updated prices.

## 5. Target scope and limits

- Market: United States.
- Listings: NYSE, NASDAQ and NYSE American.
- Security type: common stocks; exclude ETFs, bonds, warrants and preferred shares.
- Initial data scale: approximately 500–1,000 stocks, with architecture capable of expansion.
- Initial deployment: local desktop/browser application.
- Portfolio: hypothetical/model portfolio only; no brokerage integration or automatic order execution in the MVP.

## 6. Technology direction from the proposal

| Layer | Proposed technology |
|---|---|
| Web backend | Python + Flask |
| Frontend | HTML, CSS, JavaScript; Flask/Jinja templates |
| Data calculations | Pandas + NumPy |
| First market-data interface | yfinance, isolated behind a provider interface |
| Local database | SQLite |
| Database layer | SQLAlchemy is recommended in the detailed guide |
| Charts | TradingView Lightweight Charts |
| Scheduling | APScheduler, after manual workflows are reliable |
| Backtesting | Custom Python engine |

## 7. MVP definition

Build these first:

1. Load and screen a 500–1,000-stock test universe.
2. Download/store daily historical price and volume data.
3. Implement and test momentum, volatility, Z-score, Momentum Score and Top 100 ranking.
4. Calculate raw portfolio weights and apply constraints.
5. Display validated data in a basic, functional dashboard.

Backtesting, scheduling/automation and advanced optimisation are later phases.

## 8. Explicit non-goals for MVP

- Brokerage connection or real order placement.
- Intraday streaming terminal.
- Automated trading.
- Complex alerts or notification engine.
- Unnecessary technical indicators such as RSI or MACD as core strategy inputs.
- Cloud multi-user deployment unless separately approved.

## 9. Important product principle

The product is a research and simulation tool. All rankings, scores, holdings and weights must be traceable to an as-of date, data source and methodology version. Do not show fabricated sample values as live data.

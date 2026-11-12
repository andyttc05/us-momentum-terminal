# Academic Project Overview

This overview is intended for IEDA 1180 instructor review.

## Project Purpose

US Momentum Terminal studies whether recent relative price strength can be used to rank a diversified
selection of US stocks. The project turns the idea into a reproducible data pipeline, a transparent
scoring method, a constrained model portfolio, and an exploratory historical test.

The aim is educational and analytical. The application does not place trades, forecast individual
prices, or claim that a historical result will continue in the future.

## Why Study Momentum?

Momentum research examines the tendency of recent market leaders and laggards to continue their
relative performance for some period. The project uses a standard 12–1 month measure so that the
most recent month is excluded from the signal. It then adjusts the signal for each stock's recent
price volatility and compares stocks relative to one another.

This structure makes the investment idea testable. Each input, transformation, ranking rule, and
portfolio constraint can be inspected and reproduced.

## Data Collected

The application uses a curated 200-symbol US common-stock universe. The list combines an audited
108-symbol core with 92 additions selected across eleven sectors from a larger mid-cap candidate
pool.

The primary market-data provider is Yahoo Finance through the Python `yfinance` client. The service
collects:

- Daily open, high, low, close, adjusted close, and volume.
- Dividend and split fields where provided.
- Company name, sector, exchange, currency, and security type.
- Current market capitalization, shares outstanding, float shares, and three-month average volume.

Yahoo data is unofficial and may be delayed or temporarily unavailable. Optional Twelve Data and
Financial Modeling Prep adapters can be enabled with API keys.

## Data Processing

The API normalizes each provider's response into one common record format. It removes duplicate
trading dates, rejects invalid prices, preserves source and fetch timestamps, and refuses to score a
series without adjusted closes.

Before ranking, a stock must pass the universe rules: common-stock classification, USD currency,
NYSE/NASDAQ/NYSE American listing, a latest price of at least $5, at least 210 daily observations,
the common market date, and at least $2 million average daily dollar volume over 63 sessions.

The service caches price history, quote metadata, publication snapshots, and stock-detail pages.
Cached data remains visible while a refresh runs, but the interface labels it as cached. Missing
values appear as unavailable rather than being replaced with invented numbers.

## Stock Ranking

For each eligible stock, the service calculates:

1. 12–1 momentum: `P(t − 21) / P(t − 252) − 1`.
2. The sample standard deviation of the trailing 252 daily returns.
3. Risk-adjusted momentum: the decimal 12–1 return divided by daily volatility.
4. A cross-sectional Z-score among eligible stocks.
5. A Z-score clipped between −3 and +3.
6. The piecewise Momentum Score used to rank stocks.

Scores above zero map to `1 + Z`; scores below zero map to `1 / (1 − Z)`; zero maps to `1`.
Stocks are sorted by score, then risk-adjusted momentum, then ticker for deterministic ordering.

## Model Portfolio

The current model selects up to 100 stocks with verified current float shares. Preliminary weights
are proportional to float-adjusted market capitalization multiplied by Momentum Score.

A numerical solver then redistributes weights so that the portfolio remains fully invested while no
single stock exceeds 9% and no constraint sector group exceeds 35%. If those conditions cannot be
satisfied, the portfolio is marked unavailable.

The official rebalance schedule is March and September. The website shows the current model
composition; it does not infer trades from every ranking refresh.

## Backtest

The historical simulation forms a new ranking at the final March or September trading session and
executes at the next available adjusted close. It marks holdings to market daily and charges 0.10%
of traded notional.

The historical book is equal-weighted because point-in-time float-adjusted market capitalization is
not available. SPY and SPMO are used as benchmarks, and the Sharpe Ratio assumes a 0% risk-free
rate.

The test uses the audited 108-stock historical core rather than today's 200-stock live list. This
avoids directly applying the 92 newer additions to earlier dates, but it does not remove all
survivorship or selection bias because historical constituents and delisted securities are
incomplete.

## Website

The dashboard supports five views:

- Overview: strategy performance, top momentum names, and sector allocation.
- Screener: ranking, search, filters, sorting, pagination, and CSV export.
- Portfolio: model holdings, allocation, constraint checks, and full CSV export.
- Backtesting: cumulative return, risk metrics, drawdown, annual returns, and assumptions.
- Stock Analysis: price history, return summaries, momentum metrics, and rank history.

The interface preserves the existing visual design and uses a compact project-information disclosure
for the data source, methodology, assumptions, limitations, and documentation links.

## Academic Boundaries

The project is a carefully documented research prototype, not a production investment system. It
lacks point-in-time constituents, complete historical float data, delisting returns, market impact,
taxes, and live execution. The backtest is exploratory and should not be presented as proof of
future profitability.

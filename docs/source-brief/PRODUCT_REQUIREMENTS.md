# Product Requirements — Pages, Navigation and Interactions

## 1. Global navigation

Permanent sidebar entries:

1. Overview
2. Screener
3. Portfolio
4. Backtesting
5. Settings

**Stock Analysis is a contextual page**, opened by clicking a ticker in Screener or Portfolio. It is not a permanent sidebar destination. Provide a back link to the originating page where practical.

The global sidebar, logo, spacing, typography, colour system and common status/header components must remain consistent across all pages.

## 2. Overview

Purpose: concise system and strategy dashboard.

### Approved layout

- Page title: Overview; subtitle: Momentum Investing for US Equities.
- Shared data status / last successful update and refresh control.
- Three KPI cards only:
  - Scanned Stocks
  - Eligible Stocks
  - Portfolio Stocks
- Large cumulative performance chart comparing US Momentum Strategy, SPY and SPMO, with 1Y / 3Y / 5Y / All controls. Only show real strategy performance after backtesting data exists; otherwise show a transparent empty/not-yet-run state.
- Top 5 Momentum preview: rank, ticker, small sparkline, price, Momentum Score; View All links to Screener.
- Sector Allocation donut chart with sector legend.
- Yellow Model Portfolio shortcut banner displaying number of current holdings.

### Avoid

- Separate Selected and Holdings KPI cards; Portfolio Stocks combines the overlapping concept in the agreed UI revision.
- Repeating Screener controls on Overview.
- Multiple benchmark cards that duplicate the main performance chart.

## 3. Screener

Purpose: stock discovery and ranking. The stock table is the main focus.

### Approved layout

- Page title: Screener; subtitle: Find Momentum Stocks.
- Shared data status / update control.
- Compact horizontal toolbar:
  - Top 100 / Top 20% segmented selector.
  - Search ticker or company.
  - Filters button.
  - Export button.
- Sortable, paginated table. Approved columns:
  - Rank
  - Ticker
  - Company
  - Price
  - 1D Change
  - 12–1 Momentum
  - Momentum Score
  - Sector
- Subtle sparklines may be included if they do not make the table crowded.
- Positive values use muted green; negative values use muted red.
- Clicking a row/ticker opens Stock Analysis.
- Pagination and result count should be visible.

### Avoid

- Scanned / Eligible / Selected KPI cards: those belong on Overview.
- Decorative charts that compete with the table.

## 4. Portfolio

Purpose: inspect the currently active model portfolio and its constraints.

### Approved layout

- Page title: Model Portfolio; subtitle: Momentum × Market Cap.
- Shared data status / update control.
- Four KPI cards:
  - Total Holdings
  - Largest Holding (ticker and weight)
  - Top 10 Weight
  - Invested Capital / Fully Invested percentage
- Sector Allocation donut chart with legend.
- Stock Weight Distribution visualisation (for individual stock weights), not a second sector allocation chart.
- Constraints panel:
  - Maximum single-stock weight: 9%
  - Maximum sector weight: 35%
  - Target holdings: 100
  - Fully invested: 100%
- Holdings table:
  - Rank
  - Ticker
  - Sector
  - Momentum Score
  - Float-Adjusted Market Cap
  - Raw Weight
  - Final Weight
- Clicking a holding opens Stock Analysis.

### Avoid

- Two charts that both show sector weights.
- Showing sample constraints as passed if computed holdings violate them.

## 5. Backtesting

Purpose: evaluate historical strategy performance against benchmarks.

### Approved layout

- Page title: Strategy Backtest; subtitle: Historical Performance.
- Controls: Start Date, End Date, Top 100 / Top 20%, Run Backtest.
- Four KPI cards:
  - CAGR
  - Total Return
  - Sharpe Ratio
  - Maximum Drawdown
- Large Cumulative Return chart: US Momentum Strategy vs SPY vs SPMO, with 1Y / 3Y / 5Y / All filters.
- Secondary Drawdown chart.
- Annual Return table with Year, Strategy, SPY and SPMO columns.
- Compact methodology/assumptions strip showing rebalance schedule and transaction-cost assumption for the selected run.

### Avoid

- Presenting illustrative screenshot values as real results.
- Confusing daily ranking refreshes with portfolio trades.

## 6. Stock Analysis

Purpose: explain one stock's price history and momentum characteristics.

### Entry and navigation

- Contextual page opened from Screener or Portfolio.
- Include a back-to-Screener / back-to-origin link.
- Example visual uses NVDA, but the page must be ticker-dynamic.

### Approved layout

- Company name, ticker, exchange, sector and rank.
- Current/latest available price, daily price change and percentage change.
- Large historical price chart with 1M / 3M / 6M / 12M ranges.
- Performance summaries: 1M, 3M, 6M and 12M price returns.
- Momentum Analysis panel:
  - Momentum Score
  - 12–1 Momentum
  - Risk-Adjusted Momentum
  - Z-Score
- Ranking History chart. Prefer Rank as the primary plotted metric; if Score is displayed too, label the second axis clearly or display it separately.

### Metric distinction

12-month Price Return includes the latest month. 12–1 Momentum excludes the latest month. They must be separately labelled and calculated as different measurements.

### Avoid

- RSI/MACD as core strategy metrics.
- Unnecessary company description blocks.

## 7. Settings — four sub-pages

The Settings section has four tabs that share a common settings header, category navigation and Save Changes action:

1. Stock
2. Portfolio
3. Backtest
4. General

### 7.1 Stock Settings

**Stock Universe** configuration:
- Exchanges: NYSE, NASDAQ, NYSE American.
- Minimum stock price: $5.
- Minimum trading history: 10 months.
- Minimum 3-month average dollar volume: $2 million.
- Market capitalisation: no minimum requirement.

**Momentum Methodology** display/configuration:
- Momentum period: 12–1 months.
- Risk adjustment: daily-return volatility over the same measurement window.
- Standardisation: cross-sectional Z-score.
- Z-score cap: -3 to +3.
- Momentum Score transformation: required piecewise formula in `QUANTITATIVE_METHODOLOGY.md`.

The methodology is core to the strategy; do not make core calculations casually switchable or offer an invalid “None (Linear)” default.

### 7.2 Portfolio Settings

- Target number of holdings: 100.
- Weighting method: Float-Adjusted Market Cap × Momentum Score.
- Portfolio investment target: fully invested (100%).
- Rebalancing frequency: semiannual.
- Rebalancing months: March and September.
- Maximum single-stock weight: 9%.
- Maximum sector weight: 35%.
- Allocation preview may show stock-weight distribution, sector allocation and portfolio summary, but must use real computed values and not imply invalid constraints are satisfied.

### 7.3 Backtest Settings

- Default start/end dates.
- Initial investment capital.
- Portfolio selection mode: Top 100 / Top 20%.
- Primary benchmark: SPY.
- Secondary benchmark: SPMO.
- Benchmark comparison setting.
- Transaction cost assumption.
- Slippage assumption.
- Trading/data frequency wording must distinguish daily data/ranking from official semiannual rebalance.
- Rebalancing schedule and months: semiannual, March and September.
- Methodology panel explaining historical simulation, periodic rebalancing, costs and benchmark comparison.

Transaction-cost, slippage and date defaults shown in screenshots are placeholders unless explicitly approved in the configuration.

### 7.4 General Settings

- Data provider selector/status.
- API connection status.
- Data update frequency.
- Last successful update.
- Manual refresh action.
- Sector classification: GICS (if supported by selected data source).
- Market: United States.
- Currency: USD.
- Time zone: US Eastern Time for market timestamps.
- Default landing page.
- Number formatting.
- Date format.
- Theme preference.
- Default table page size.
- Application version and database/provider health.

Do not hard-code Polygon as the provider merely because it appears in the design. The original proposal specifies yfinance for the first version behind a replaceable provider abstraction.

## 8. Shared components

- Sidebar/navigation.
- Page header and breadcrumb.
- Shared data freshness/status display.
- KPI card.
- Chart card and legend.
- Table with sorting/pagination.
- Filter/search toolbar.
- Button, dropdown, segmented control, slider, switch, tooltip.
- Empty/loading/error states.
- Save Changes and unsaved-changes feedback for Settings.

## 9. Data states and UX rules

Every analytical page must show data as-of date and freshness/status. The application must visibly distinguish:

- Live/current data successfully fetched.
- Stored data that is stale.
- Missing/partial data.
- No calculation/backtest yet.
- Failed data provider or calculation.

Never silently replace unavailable market data with fabricated data. Demo data must be clearly marked as demo/sample.

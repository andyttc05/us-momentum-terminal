# UI Regeneration Prompts

Use these prompts only when regenerating a page image or revising the visual concept. Attach the matching reference screenshot and the Miyama visual reference when possible. The screenshots already included in `UI_REFERENCES/` are the current approved conceptual blueprint.

## Global consistency instruction

This page belongs to the same US Momentum Terminal application as the other screens. Maintain exactly the same sidebar layout and dimensions, logo, navigation, typography, cream background, pastel palette, card radius/shadows, buttons, dropdowns, spacing, icon line weight and organic blob illustration style. The page-specific content/layout may vary to suit its purpose. Do not redesign the overall application or invent extra content. Prioritise visual quality, usability, whitespace and consistency. Treat all sample financial numbers as placeholders, not real market data.

## Overview

Design a desktop Overview dashboard for US Momentum Terminal in the Miyama Graphics-inspired style. Include the shared left sidebar; page title and data status; exactly three KPI cards (Scanned Stocks, Eligible Stocks, Portfolio Stocks); one large performance chart comparing US Momentum Strategy, SPY and SPMO; a compact Top 5 Momentum list; one Sector Allocation donut; and a yellow Model Portfolio shortcut banner. Do not add separate Selected and Holdings KPI cards. Keep whitespace and use blob mascots selectively.

## Screener

Design a desktop Screener page. Keep the same sidebar and design system. The stock table must be the main focus. Include Top 100 / Top 20% selector, search, Filters and Export in one compact toolbar. Use a sortable, paginated table with Rank, Ticker, Company, Price, 1D Change, 12–1 Momentum, Momentum Score and Sector. Do not show Overview KPI cards. Keep charts and decoration minimal.

## Portfolio

Design a desktop Model Portfolio page. Include four KPI cards (Total Holdings, Largest Holding, Top 10 Weight, Invested Capital); a Sector Allocation donut; a different Stock Weight Distribution visualisation; a highlighted Constraints panel; and a spacious holdings table with Rank, Ticker, Sector, Momentum Score, Float-Adjusted Market Cap, Raw Weight and Final Weight. Do not repeat sector allocation in a second chart. Do not imply constraints pass if they do not.

## Backtesting

Design a desktop Strategy Backtest page. Include Start Date, End Date, Top 100 / Top 20% and Run Backtest controls; four metrics (CAGR, Total Return, Sharpe Ratio, Maximum Drawdown); a large cumulative return chart comparing Strategy, SPY and SPMO; smaller Drawdown and Annual Return panels; and a compact methodology strip showing actual rebalance/cost assumptions. Use placeholders only in the illustration.

## Stock Analysis

Design a contextual Stock Analysis page using NVDA only as a sample ticker. Include a back link, company/ticker/exchange/sector/rank, price and daily move, large price chart with 1M/3M/6M/12M controls, four price-return summary cards, a Momentum Analysis panel (Momentum Score, 12–1 Momentum, Risk-Adjusted Momentum, Z-Score), and Ranking History. Clearly distinguish trailing 12-month price return from 12–1 momentum.

## Stock Settings

Design a Settings / Stock page with the shared Settings category tabs (Stock, Portfolio, Backtest, General) and Save Changes. Use two clear cards: Stock Universe and Momentum Methodology. Universe thresholds: NYSE/NASDAQ/NYSE American common stocks, minimum price $5, minimum trading history 10 months, 3-month average dollar volume at least $2M, no minimum market cap. Methodology: 12–1 momentum, daily-return volatility, cross-sectional Z-score capped ±3, required piecewise Momentum Score formula. Do not add a linear/none transform.

## Portfolio Settings

Design a Settings / Portfolio page with Portfolio Construction, Weight Constraints, Allocation Preview and Constraint Information panels. Show target 100 holdings, float-adjusted market cap × Momentum Score, fully invested, semiannual March/September rebalancing, max stock 9%, max sector 35%. Allocation preview must not duplicate the same metric without purpose.

## Backtest Settings

Design a Settings / Backtest page with Historical Period, Benchmark Configuration (SPY and SPMO), Trading Assumptions and Backtest Methodology cards. Include start/end date, starting capital, Top 100/Top 20%, transaction cost, slippage, semiannual March/September rebalance. Label example defaults as illustrative until approved.

## General Settings

Design a Settings / General page with Market Data, Market Classification, Application Preferences and System Information cards. Include provider/connection, update frequency, last successful update/manual refresh, GICS if supported, US market, USD, US Eastern Time, landing page, number/date formatting, theme and table page size. Do not hard-code a specific provider from the visual reference; provider is a configuration decision.

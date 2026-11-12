# UI Design Blueprint — Approved Visual Direction

> Note: the reference screenshot images in `UI_REFERENCES/` (including the Miyama
> visual reference) are third-party design material and are not redistributed in
> this repository. This document preserves the written design direction they
> supported; the image file names below are retained for traceability only.

## 1. Product visual identity

The approved design direction combines Miyama Graphics-inspired Japanese graphic design with an approachable premium finance dashboard and Apple-style simplicity.

### Colour palette

| Role | Colour |
|---|---|
| Primary background | Warm cream `#F7F3EE` |
| Primary text | Near-black `#111111` |
| Main card | White / warm off-white |
| Accent yellow | `#FFE59A` |
| Mint green | `#B7E1D1` |
| Soft pink | `#FFB5C1` |
| Light blue | `#A9D3EF` |
| Optional lavender | Muted pastel purple |
| Positive movement | Muted green |
| Negative movement | Muted red/pink |

Use exact colours consistently. Do not introduce unrelated saturated colours.

### Typography and shapes

- Rounded, friendly sans-serif typeface; use a consistent available web font.
- Strong, short page headings; compact uppercase eyebrow labels and subtitles.
- Generous whitespace.
- Rounded cards, pill controls and soft subtle shadows.
- Minimal line icons with consistent stroke weight.
- Organic blob characters with two black eyes as the visual motif.
- Blob illustrations should be selective accents, not repeated in every card or placed over important numbers.

### Overall layout

- Desktop-first application.
- Fixed left sidebar with logo and permanent navigation.
- Main content area with page-specific composition.
- Shared page-header/status pattern where suitable.
- The sidebar should be visually identical on all screens.
- Page layouts may differ to suit their function; do not force every page into the same card grid.

## 2. Main navigation

Permanent sidebar:

- Overview
- Screener
- Portfolio
- Backtesting
- Settings

Settings has four category tabs: Stock, Portfolio, Backtest, General.

Stock Analysis is contextual and opened from a stock row; it is not a permanent sidebar item.

## 3. Global design rules

- Design priority is visual clarity and hierarchy, not information density.
- Keep each page focused on one purpose.
- Avoid duplicating the same metric or chart across adjacent cards.
- Do not display redundant KPI cards.
- Use no more than necessary; preserve whitespace.
- Prefer one primary visualisation and only relevant supporting panels.
- Show clear loading, empty, stale and error states.
- All financial metrics need labels, units, time periods and as-of dates.
- UI screenshots are references for layout/style, not sources of real data values.

## 4. Screen-by-screen reference map

### 01 Overview — `UI_REFERENCES/01_Overview.png`

- Three KPI cards: Scanned Stocks, Eligible Stocks, Portfolio Stocks.
- Main cumulative performance chart: Strategy, SPY, SPMO.
- Top Momentum top-five preview.
- Sector Allocation donut chart.
- Model Portfolio shortcut banner.
- Shared update status and refresh control.

### 02 Screener — `UI_REFERENCES/02_Screener.png`

- No Scanned/Eligible/Selected KPI cards.
- Top 100 / Top 20% switch, search, Filters, Export.
- Wide stock table, sort icons, pagination.
- Ranking, ticker, company, price, 1D change, 12–1 Momentum, score, sector.
- Keep table the dominant element.

### 03 Portfolio — `UI_REFERENCES/03_Portfolio.png`

- Four KPI cards: Total Holdings, Largest Holding, Top 10 Weight, Invested Capital.
- Sector Allocation donut with legend.
- Stock Weight Distribution chart for individual names.
- Yellow Constraints panel.
- Holdings table with rank, ticker, sector, score, float-adjusted market cap, raw weight and final weight.

### 04 Backtesting — `UI_REFERENCES/04_Backtesting.png`

- Start Date / End Date, Top 100 / Top 20%, Run Backtest.
- KPI cards: CAGR, Total Return, Sharpe Ratio, Maximum Drawdown.
- Large cumulative return chart (Strategy, SPY, SPMO).
- Smaller Drawdown chart and Annual Return table.
- Compact methodology strip.

### 05 Stock Analysis — `UI_REFERENCES/05_Stock_Analysis.png`

- Contextual Back to Screener navigation.
- Company name/ticker/exchange/sector/rank.
- Current/latest price and daily change.
- Large price chart with 1M/3M/6M/12M controls.
- Return summaries.
- Momentum Analysis card: score, 12–1 momentum, risk-adjusted momentum, Z-score.
- Ranking History chart.

### 06 Stock Settings — `UI_REFERENCES/06_Settings_Stock.png`

- Shared settings tabs and Save Changes.
- Stock Universe card.
- Momentum Methodology card.
- Values must match `QUANTITATIVE_METHODOLOGY.md`.
- Do not expose invalid linear/none score transform; use the required piecewise transformation.

### 07 Portfolio Settings — `UI_REFERENCES/07_Settings_Portfolio.png`

- Portfolio Construction card.
- Weight Constraints card.
- Allocation Preview.
- Constraint Information card.
- Target 100 holdings, weight method, 100% invested, semiannual March/September rebalance, max 9% stock and 35% sector caps.

### 08 Backtest Settings — `UI_REFERENCES/08_Settings_Backtest.png`

- Historical Period card.
- Benchmark Configuration card (SPY and SPMO).
- Trading Assumptions card.
- Backtest Methodology card.
- Defaults such as date range, starting capital, transaction cost and slippage are placeholders unless confirmed in configuration.
- Distinguish data/ranking frequency from portfolio trading/rebalancing frequency.

### 09 General Settings — `UI_REFERENCES/09_Settings_General.png`

- Market Data: provider, connection status, update frequency, last success, manual refresh.
- Market Classification: GICS if supported, United States, USD, US Eastern Time.
- Application Preferences: landing page, number/date format, theme, table page size.
- System Information: app version, provider/database status.
- Do not hard-code Polygon as provider; proposal says yfinance first with replaceable abstraction.

### 00 Miyama visual reference — `UI_REFERENCES/00_Miyama_Graphics_Visual_Reference.jpg`

This image is inspiration for colour, typography, rounded composition and organic characters. It is not a literal layout requirement.

## 5. Cross-screen consistency

Keep identical:

- Sidebar dimensions, logo, icons and active state.
- Main background, font hierarchy, card radius and shadows.
- Button, dropdown, segmented control, slider, switch and input treatment.
- Spacing scale and chart palette.
- Blob illustration style.
- Shared update/status component.

## 6. Visual QA checklist

- [ ] All pages use one shared sidebar component.
- [ ] Active navigation is correct.
- [ ] Settings sub-tabs and active state are consistent.
- [ ] No duplicated KPI or repeated chart content without a purpose.
- [ ] Tables remain readable at normal desktop size.
- [ ] Illustrations do not overlap numbers or data labels.
- [ ] Loading/error/empty states follow the same visual system.
- [ ] Screenshot comparisons are made against the provided reference images.

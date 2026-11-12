# Screener visual QA

**Result: passed**

## Reference review

Compared the implemented Screener against the supplied 1680 × 941 concept image. The page retains the reference's fixed left navigation, upper title and update area, single toolbar row, wide eight-column stock table, compact row rhythm, and right-aligned pagination. Cream surfaces, yellow selection/rank accents, restrained green/red data states, rounded controls, and decorative mascot placements reuse the established Visual Foundation.

## Desktop viewport checks

| Viewport | Document size | Page-level vertical scroll | Result |
| --- | --- | --- | --- |
| 1440 × 900 | 1440 × 900 | None | Pass |
| 1366 × 768 | 1366 × 768 | None | Pass |
| 1366 × 1024 | 1366 × 1024 | None | Pass |

All key page sections remain visible at each desktop size. The fixed sidebar remains full-height. The table does not create page-level horizontal overflow.

## Interaction checks

- Top 100 shows 100 static fixture rows; Top 20% shows 20.
- Ticker and company search each return expected matches; clear search restores the full result set.
- Sector, minimum/maximum price, minimum 12–1 momentum, and minimum score filters apply together; Reset restores all rows.
- Sort controls reorder rows and update the displayed ranks; pagination advances from rows 1–10 to 11–20.
- CSV export downloads all 100 current results, including the header row.
- Mobile layout scrolls vertically and keeps the wide table usable with horizontal scrolling.
- Only one subtle DEMO DATA indicator is shown. No disclaimers or redundant KPI/chart descriptions appear on the Screener.
- No browser console errors were observed.

## Build

`npm run build` passed, including the Sites build preparation step.

Screenshots for the three requested desktop viewports were captured during browser QA and are included with the implementation handoff.

## Settings module QA

**Result: passed**

- Implemented four Settings categories in one shared shell with consistent breadcrumb, title/subtitle, tab bar, Save Changes and Reset defaults actions, cards, icons, and existing mascot system.
- Desktop screenshots were captured and reviewed at 1440 × 900 for Stock, Portfolio, Backtest, and General. All four screenshots are displayed inline in the Codex session; the browser screenshot API did not expose persistent local image paths.
- Checked each category at 1366 × 768 and 1366 × 1024. The header, actions, and all settings cards remain visible without page-level vertical scrolling at both sizes. The responsive 390 × 844 view stacks cards and scrolls naturally; toolbar actions no longer overlap the first card.
- Stock defaults and fixed methodology match the Task 10 brief: all three exchanges, $5 price, 10 months, $2 million average dollar volume, no market-cap floor, 12–1 momentum, daily-volatility adjustment, cross-sectional Z-score, ±3 cap, and the piecewise score transformation. The pending 13-month universe-threshold decision remains explicitly pending and is explained in the trading-history tooltip.
- Portfolio defaults match the project settings: 100 holdings, float-adjusted market cap × momentum score, semiannual March/September rebalancing, 9% stock cap, and 35% sector cap. The illustrative sector allocation totals 100% with Technology at 34%. The preview is labeled illustrative and does not claim to recalculate when controls change. The five Portfolio Construction fields, including rebalance months, remain visible at desktop sizes.
- Backtest defaults and controls include the 2015-01-01 start, 2026-11-10 demo end date, $100,000 capital, Top 100 selection, SPY/SPMO benchmarks, 0.10% cost, 0.00% slippage, daily ranking evaluation, and semiannual March/September rebalancing. Invalid capital and date ranges show inline errors and prevent saving.
- General Settings reports the provider as Not Configured (or Not Connected for the local CSV placeholder), database as Not Connected, and update timestamps as Unavailable. Refresh Data confirms that no refresh ran when no source is configured. The app does not claim a live provider, database, or GICS source.
- Changed a Stock setting, switched categories, and confirmed the unsaved draft remained. Saved it, reloaded the app, and confirmed the value persisted. Reset defaults restored the Stock and Portfolio defaults; those defaults were saved afterward. Moving a Portfolio slider updated its percentage and constraint status immediately.
- Settings are stored in browser localStorage; drafts are stored for the active browser session. There is no backend persistence or market-data connection. The allocation preview is illustrative and does not recalculate from selected constraints. Theme and GICS are informational because those integrations are not implemented.
- Browser console logs were not exposed by the available in-app browser control surface. No runtime errors were surfaced during navigation or interaction; the production build passed after the final changes.

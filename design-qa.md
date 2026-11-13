# Backtesting and Chart Interactions — Design QA

**Final result: passed**

## Comparison targets

- Cumulative-return source: `/Users/andyttc/Downloads/Unknown-6.png`, `1920 × 819`.
- Performance-summary source: `/Users/andyttc/Downloads/Unknown-7.png`, `2172 × 724`.
- Desktop implementation: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/backtesting-final-desktop-top.jpg` and `qa-output/backtesting-final-desktop-lower2.jpg`, `1440 × 1009`, density `1`.
- Mobile implementation: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/backtesting-final-mobile-top.jpg`, `qa-output/backtesting-final-mobile-chart.jpg`, and `qa-output/backtesting-final-mobile-bottom.jpg`, `390 × 844`, density `1`.
- State: defaults with Top 100, full available history, `$10,000` initial capital, `$1,000` monthly contributions, total-return mode, nominal prices, Include YTD on, Linear scale, and Advanced Settings collapsed. Additional expanded, focus, hover, CPI, dividend and responsive states were exercised.

## Combined comparison evidence

- Cumulative card comparison: `qa-output/backtesting-comparison-cumulative-v7.jpg` places the supplied reference above the rendered chart at a shared `1200px` width.
- Performance Summary comparison: `qa-output/backtesting-comparison-summary-v7.jpg` places the supplied reference above the rendered summary at a shared `1200px` width.
- Tooltip evidence: `qa-output/backtesting-v7-tooltip-left.jpg`, `backtesting-v7-tooltip-center.jpg`, and `backtesting-v7-tooltip-right.jpg`.
- Settings and focus evidence: `qa-output/backtesting-v7-advanced.jpg`, `backtesting-v7-info-tooltip.jpg`, and `backtesting-final-money-focus.jpg`.
- Cross-page chart evidence: `qa-output/overview-performance-tooltip-v7.jpg`, `overview-performance-tooltip-mobile-v7.jpg`, and `stock-ranking-tooltip-v7.jpg`.

The source and implementation are shown in the same comparison image before judging fidelity. Their displayed portfolio values are not expected to match because the reference values are illustrative while the implementation is bound to the live publication.

## Findings

No actionable P0, P1 or P2 findings remain.

- Fonts and typography: Nunito Sans, weight hierarchy, card-title scale and tabular numerals are preserved. The reference's larger presentation scale was matched by increasing the cumulative chart and summary-card proportions rather than altering type families.
- Spacing and layout rhythm: Advanced Settings is one continuous card with enclosed warm-neutral mini-cards. Its expansion leaves Start Date, End Date, Universe and Run Backtest at identical x/y coordinates and dimensions.
- Colors and visual tokens: The cumulative chart preserves yellow Strategy, blue SPY and purple SPMO. Annual Return now uses subtle matching column tints while positive/negative values remain green/red. Monetary focus uses the shared restrained pastel-yellow border, with no blue browser glow or added halo.
- Image quality and assets: Existing mascot assets and Phosphor icons are reused. No placeholder imagery or decorative approximation was introduced. SVG content is limited to data visualization.
- Copy and content: Log Scale, chart dates and percentages, CPI/dividend methodology text, partial-year/YTD labels, real/nominal SPY comparison wording and concise information tooltips are explicit.

## Interaction verification

- Linear is the default. Log Scale transforms the wealth index `1 + cumulative return`, keeps axis labels as actual cumulative percentages, and does not rerun the backtest.
- Cumulative hover uses a real observation, a vertical crosshair and highlighted points for all three series. Left, centre and right positions kept the tooltip and all three final-value pills inside the chart card.
- Tooltip placement follows pointer direction and flips at boundaries. Touching or clicking the mobile chart selects an observation.
- Final-value pills remain visible while hovering on desktop and are also retained in the compact mobile chart gutter.
- Advanced Settings default-collapsed and expands downward. Pre/post measurements for Start Date, End Date, Universe and Run Backtest were identical.
- Cashflows reveal Contribution Amount and Frequency only when enabled. Monthly, quarterly and annual timing remain available.
- Information buttons open black tooltips on hover/click/focus, do not shift layout, and close when tapping outside. Desktop and mobile viewport containment passed.
- Performance chart hover exposes the actual date and Strategy, SPY and SPMO returns with crosshair and highlighted points.
- Ranking History hover exposes the actual date, rank and Momentum Score with crosshair and both selected points. Left rank and right score axes remain separately labelled.
- Annual Return headers are sticky, the scroll region uses `overflow-y: auto` with a thin scrollbar, and highlights remain attached to their data columns. The nine current rows fit without a redundant scrollbar.
- Transient feedback uses the shared black notification card. On mobile it sits above the bottom navigation; the persistent freshness indicator remains visible below the page subtitle.
- Document overflow was `0px` at `375`, `390`, `430`, `768`, `1100` and `1440` CSS pixels.
- Browser console errors after the final interaction pass: none.

## Data verification

- Corporate-action coverage: `108` securities checked, `108` verified, `0` incomplete; source `yahoo`.
- The published total-return strategy ends at `464.57` wealth units; the dividend-cash path ends at `463.35`. SPY is `334.45` versus `309.13`, and SPMO is `431.95` versus `404.50`, confirming that benchmark conventions respond to the toggle.
- All four Reinvest Dividends / Inflation Adjusted combinations were run in the browser. KPIs, Profit/Loss, final value, Total Contributions, TWR, XIRR, relative SPY performance and Annual Return updated. Each toggle retained its independent state.
- CPI source is official CPI-U All Items (`CPIAUCNS`, BLS via FRED). The live payload contains `117` observations from `2017-01-01` through `2026-10-01`; the source's missing `2025-10` value is reported rather than interpolated.
- CPI observations become available on the 15th of the following month. A November 12 valuation therefore uses the latest previously published observation rather than the October print before its availability date.
- Real mode deflates the starting capital, historical contributions and terminal value with the same aligned CPI series before TWR/XIRR and summary reporting.

## Tests and checks

- Python quantitative suite: `51` tests passed.
- Frontend unit suite: `92` tests passed.
- Production Vite build completed.
- Sites packaging test completed.
- Live desktop and mobile browser interaction pass completed against the refreshed FastAPI publication.

## Comparison history

1. The first pass omitted Log Scale and retained a divider-heavy Performance Summary.
   - Fix: added the wealth-index log transform, integrated chart controls and the rounded card-based summary from the approved concept.
2. The first price-only path applied Yahoo split actions to closes that were already split-normalized.
   - Fix: stopped the second split adjustment and added a regression test. Dividend-cash wealth now stays close to total return instead of multiplying historical splits into the result.
3. Mobile initially omitted final-value pills, and Drawdown year labels could crowd together.
   - Fix: reserved a compact right gutter for all three pills and applied collision filtering to Drawdown year labels.
4. KPI values initially reused backend total-return metrics after Dividend Reinvestment was switched off.
   - Fix: reuse authoritative backend metrics only for the unchanged total-return/nominal path; all alternate modes derive from the selected series.
5. The first hover implementation depended on pointer position rather than movement direction.
   - Fix: added the existing movement-aware side flipping and boundary containment to the Backtesting, Overview and Ranking History charts.

## Follow-up polish

- The live reference values differ from the implementation because the screenshots are illustrative and the app renders current provider data.
- Yahoo Finance remains an unofficial provider. The published corporate-action coverage report makes incomplete provider data visible but cannot eliminate provider-side historical revisions.
- The historical core still has the existing survivorship and current-constituent limitations documented in the README.

## Implementation checklist

- Preserve the single Advanced Settings parent card and stable top-row grid.
- Preserve the Linear/Log Scale distinction and actual percentage labels.
- Keep total return, dividend cash and CPI deflation as separate, explicit conventions.
- Re-run browser comparison evidence after changes to chart height, annual-table density or summary proportions.

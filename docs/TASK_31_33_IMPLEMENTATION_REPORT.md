# Tasks 31-33: Implementation Report

Date: 12 November 2026  
Data as-of: 11 November 2026

## Final Universe

| Metric | Result |
|---|---:|
| Target live universe | 200 |
| Audited core retained | 108 |
| Mid-cap additions retained | 92 |
| Successfully scanned | 200 |
| Fully eligible | 198 |
| Top 100 holdings | 100 |
| Top 20% | 40 (`ceil(198 × 0.20)`) |

The requested source universe is exactly 200. Two source symbols fail the unchanged filters:

- `TSM`: ADR, not a common-stock instrument.
- `PARA`: reused ticker with incompatible history and a latest close below $5.

No replacement was necessary to preserve the 200-symbol source target. The eligible count remains
an actual result rather than a hardcoded number.

## Selection Method

- The 108-symbol audited core remains unchanged.
- The existing approved 200-stock S&P MidCap 400 pool remains available for future replacements.
- Ninety-two additions were selected with static sector quotas.
- Within each sector, candidates were sampled at even positions across the approved list.
- Selection used no market price, Momentum Score, historical return or future outcome.

### Live Universe Sector Distribution

| Sector | Source universe |
|---|---:|
| Technology | 36 |
| Healthcare | 22 |
| Industrials | 22 |
| Consumer Discretionary | 20 |
| Financials | 18 |
| Consumer Staples | 16 |
| Real Estate | 14 |
| Communication | 13 |
| Energy | 13 |
| Utilities | 13 |
| Materials | 13 |

After source metadata is replaced by provider sector metadata and eligibility checks run, the
eligible mix is: Technology 34, Healthcare 23, Industrials 22, Consumer Discretionary 21,
Financials 18, Consumer Staples 17, Energy 14, Real Estate 14, Communication 13, Utilities 12 and
Materials 10.

### Exchange And Capitalisation Coverage

| Exchange | Eligible stocks |
|---|---:|
| NYSE | 137 |
| NASDAQ | 60 |
| NYSE American | 1 |

| Current market cap | Eligible stocks |
|---|---:|
| Mega, at least $200B | 41 |
| Large, $10B-$200B | 98 |
| Mid, $2B-$10B | 59 |

The source scan contains 59 mid-cap companies and 139 large/mega-cap companies. No small-cap
company was retained.

## Methodology Preservation

The following remain unchanged:

- Common-stock and exchange filters.
- $5 minimum price.
- 210-observation universe eligibility.
- 253-observation 12-1 momentum requirement.
- $2 million three-month average daily dollar volume.
- Adaptive daily volatility and capped cross-sectional Z-score.
- Piecewise Momentum Score.
- Score ranking and Top 100 / Top 20% behavior.
- Float-adjusted market cap × score weighting.
- 9% stock cap and 35% sector-group solver.
- Semiannual March/September backtest.

Cross-sectional scores and ranks were recalculated using the new 198-stock eligible cross-section.
The backtest remains on the audited 108-symbol historical core.

## Sector Allocation Presentation

The sector card now uses the available card area more effectively:

- Enlarged donut where width permits.
- Donut left, legend right.
- Compact, evenly distributed legend rows.
- Left-aligned names and right-aligned percentages.
- Actual provider-backed sector categories rather than collapsing five sectors into "Others".
- Integer overview percentages use largest-remainder rounding so displayed values sum to exactly
  100%.

Current portfolio sector legend: Technology 35%, Communication 15%, Healthcare 13%, Consumer
Discretionary 0%, Consumer Staples 10%, Industrials 4%, Financials 6%, Energy 13%, Materials 2%,
Utilities 0% and Real Estate 2%.

Portfolio weights and solver grouping did not change. Detailed sectors are now used for
presentation.

## Top Momentum Presentation

The card uses one five-column grid for every row:

```text
36px | 65px | minmax(76px, 1fr) | 85px | 68px
```

- Score pills are fixed at 64px on desktop instead of stretching.
- Sparklines occupy a bounded flexible column.
- Prices are right-aligned in a consistent 85px column.
- All five rows use identical 35px heights.
- Compact-height and phone breakpoints preserve the same visual relationships.

## Screener Card

The table section now uses the shared `dashboard-card` surface. Header, all rows, dividers, range
information and pagination are inside one rounded white card.

The card uses natural content height rather than forcing the rows or pagination apart to fill the
viewport. At 1366px, all rows measured 38px and the card, table and pagination shared one continuous
surface.

At 390px:

- Body width remained exactly 390px.
- Only the inner table scrolls horizontally.
- The card, toolbar and pagination remain inside the viewport.

## Responsive Verification

| Width | Result |
|---|---|
| 1440 × 900 | Passed; all nine columns and compact score pills |
| 1366 × 768 | Passed; 38px rows, integrated pagination |
| 1024 × 768 | Passed; unified card and inner horizontal table scroll |
| 390 × 844 | Passed; no page overflow, compact cards, inner table scroll |

Browser console: no errors or warnings.

## Evidence

- `docs/task31-33-screenshots/overview-1440.png`
- `docs/task31-33-screenshots/screener-1440.png`
- `docs/task31-33-screenshots/overview-390.png`
- `docs/task31-33-screenshots/screener-390.png`

The attachment contained the written brief only; no separate reference image files were available in
the mounted attachment folder. The refinement followed the specified dimensions and the existing
application design system.

# Cross-Page Layout Refinement — Implementation Report

**Scope:** all five pages (Overview, Screener, Portfolio, Backtesting, Stock Analysis). Settings stays removed.

**Type of work:** layout refinement against the supplied reference images — no redesign, no new sections, no changes to data, navigation, calculations or interactions.

---

## 1. Global layout system (unchanged core, now fully applied)

The shared layout layer introduced for the consistency pass is the backbone of this refinement:

| Layer | File | What it controls |
|---|---|---|
| Tokens | `frontend/src/styles/tokens.css` | container padding, header height, section/card gaps, card padding, type scale |
| Layout | `frontend/src/styles/layout.css` | `.page` container, `.page-header` grid, `.update-bar` pill, breakpoint overrides |
| Header | `frontend/src/components/PageHeader.jsx` | eyebrow / title / subtitle / mascot / controls for the four main pages |
| Update bar | `frontend/src/components/UpdateBar.jsx` | one pill for all four main pages, date formatting inside the component |

Measured at 1440 × 900, the four main pages are numerically identical:

| Page | Header | Eyebrow | Title | Subtitle | Update bar | First content |
|---|---|---|---|---|---|---|
| Overview | x 229, y 34, h 104 | y 39 | x 229, y 61, 45.36px/900 | y 116 | x 1162, 253 × 48 | y 156 |
| Screener | x 229, y 34, h 104 | y 39 | x 229, y 61, 45.36px/900 | y 116 | x 1162, 253 × 48 | y 156 |
| Portfolio | x 229, y 34, h 104 | y 39 | x 229, y 61, 45.36px/900 | y 116 | x 1162, 253 × 48 | y 156 |
| Backtesting | x 229, y 34, h 104 | y 39 | x 229, y 61, 45.36px/900 | y 116 | x 1162, 253 × 48 | y 156 |

Stock Analysis keeps its contextual structure (back button → profile → price → chart → returns, with the analysis column on the right) but uses the same container, eyebrow/title/subtitle scale and `--section-gap` rhythm. Its two columns both run 34 → 872 px, so they end on the same line.

---

## 2. Vertical balance — no more dead space at the bottom

The three pages that left a blank band under their last card now distribute the viewport:

**Overview** — the page is a flex column (`min-height: 100vh`): the KPI row keeps its height and the two-column grid takes the rest. Inside it, the Performance chart takes the slack in the left column while the Model Portfolio banner keeps its natural height at the bottom, and the Sector Allocation card takes the slack in the right column. Both columns now end on the same line and the dashboard reaches the bottom margin.

**Screener** — the toolbar keeps its height and the table card fills the rest. The table's `height: 100%` (with `flex: 1 1 0` on the scroll area so the percentage resolves) lets the browser share the leftover height across the rows: the ten rows grow from 40 px to ~51 px at 1440 × 900 and the pagination ends at the bottom margin instead of floating mid-page.

**Stock Analysis** — both columns fill the viewport height; the chart card absorbs the slack and the returns row stays pinned to the bottom.

**Result at 1440 × 900:** content now ends at 872 px on Overview, Screener, Backtesting and Stock Analysis — exactly the 28 px shared bottom margin, i.e. **zero wasted space** (previously ~140 px). Portfolio still scrolls, because it lists 10 holdings plus pagination; that is content volume, not layout drift, and the task explicitly asks to keep all 100 holdings reachable through pagination.

Nothing was stretched to achieve this: cards keep their natural proportions, the Performance chart and the Sector donut scale proportionally inside the space they are given, and no fixed heights were added.

---

## 3. Chart proportions — the real cause of the distortion

Every chart was drawn with a fixed `viewBox` and `preserveAspectRatio="none"`, which stretched the drawing to fill its box. That is why the endpoint markers were ellipses, the value pills were flattened, and the axis labels looked squeezed and tall.

The fix is a rendering-model change, not a visual patch:

* New `frontend/src/components/useElementSize.js` measures the chart container with a `ResizeObserver`.
* Each chart now draws itself at **1:1 CSS pixels** — `viewBox="0 0 width height"` taken from the measured box — so one SVG unit equals one pixel and nothing can be scaled out of shape.
* Converted charts: Stock Analysis price chart and Ranking History, Backtesting cumulative return and drawdown, Overview performance chart.

Consequences:

* Endpoint markers are true circles again (price, ranking, cumulative, drawdown trough).
* Value pills keep their rounded shape; the price label now sits directly beside the final point with a 12 px gap instead of floating in a fixed box.
* Axis labels and pill text render at their intended size on both axes.
* Left/right axis gutters are reserved inside the measured box, so the Ranking History score labels can no longer touch the card edge.
* The price chart shows all twelve month labels, as in the reference.

The Backtesting drawdown callout stays an HTML overlay (never scaled by an SVG) and is now positioned from the measured geometry.

---

## 4. Top Momentum sparklines

The sparkline used to fill the whole flexible column (`width: 100%` with `preserveAspectRatio="none"`), so it ran ~107 px wide and looked stretched.

* The sparkline is now a **fixed 64 px** mini-chart (56 px compact, 48 px small screens) with its natural aspect ratio (`height: auto`).
* The row uses a controlled five-column grid: `30px · 52px · 64px · auto · minmax(54px, 1fr)` — rank, ticker, sparkline, price, score.
* The price sits immediately after the sparkline, the score pill is pinned to the far right with `justify-self: end`, and every gap is the same 8 px.
* The sparkline is still a live SVG built from the same momentum data — no static images, no data changes.

---

## 5. Reference-image fidelity

Checked page by page against the supplied references:

* **Overview** — the range control (1Y / 3Y / 5Y / All) now sits in the Performance card header next to the title, with the series legend on the row below, exactly as in the reference. Header, three KPI cards, chart left, Top Momentum + Sector Allocation right, Model Portfolio banner below the chart — all unchanged in structure.
* **Screener** — header + Update Bar, Top 100 / Top 20% selector, search / Filters / Export toolbar, full-width table, pagination at the bottom ✓.
* **Portfolio** — four KPI cards, the three-column analytical row (Sector Allocation, Stock Weight Distribution, Constraints) and the full-width Holdings table with pagination to all 100 holdings ✓.
* **Backtesting** — compact control toolbar, four KPI cards, Cumulative Return left, Drawdown and Annual Return right. The removed Methodology card was **not** reintroduced ✓.
* **Stock Analysis** — back navigation, profile, price summary, historical chart, return metrics, Momentum Analysis, Ranking History, two-column layout ✓. The `STOCK ANALYSIS` label sits above the company name on the left, the exchange/sector line is uppercase (`NASDAQ · TECHNOLOGY`), and **no Yahoo Finance or date information** was added to this page.

---

## 6. Verification

* **Build:** `npm run build` passes (Vite 6.4.2 + Sites packaging).
* **Sites tests:** `npm run test:sites` — 4/4 pass.
* **Interaction smoke test:** 17/17 pass — sidebar navigation, ticker → Stock Analysis → back, pagination page 2, filter panel open/reset, Run Backtest toast, period control switch, active Sidebar item still yellow `rgb(255, 229, 154)`, no transform on hover.
* **Console:** no errors on any page.
* **Responsive:** 1440 × 900, 1366 × 768 and 1366 × 1024 — no page-level vertical scroll on Overview, Screener, Backtesting and Stock Analysis; no horizontal overflow anywhere. At 390 × 844 every page keeps `scrollWidth == viewport width` and scrolls naturally.

---

## 7. Evidence

* `screenshots/global-consistency/{page}-{1440x900,1366x768,1366x1024}.png` — all five pages at identical viewport dimensions.
* `screenshots/global-consistency/all-pages-1440x900.png` — the five pages side by side.
* `screenshots/global-consistency/header-alignment-comparison.png` — the four main headers stacked on shared guides (content edge x = 229, title top y = 61, first content y = 156).

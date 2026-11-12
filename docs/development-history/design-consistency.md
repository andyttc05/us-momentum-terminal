# Global Design Consistency — Implementation Report

**Scope:** Overview, Screener, Portfolio, Backtesting, Stock Analysis (Settings stays removed — it was not recreated and is not in the Sidebar).

**Type of work:** global consistency refinement. No page information architecture was changed, no section was added, removed or reordered, and no new mascot artwork was created.

---

## 1. Shared components that were standardised

| Component | Before | After |
|---|---|---|
| **Page header** | Four hand-written `<header class="overview-header">` blocks, each with its own eyebrow / title / subtitle markup, margins, font sizes and mascot offsets | One new `src/components/PageHeader.jsx`. Every main page renders `<PageHeader eyebrow title subtitle art controls />`; all typography, spacing and the mascot track come from the shared layout system |
| **Update bar** | Shared component, but each page positioned it inside its own header markup and Backtesting formatted its own date string | `src/components/UpdateBar.jsx` is now fully self-contained: dot, state label, date, divider and refresh button in one pill, with the date formatted inside the component (`formatDateLabel`) so all four pages render the identical `Nov 11, 2026` style |
| **Page container** | `.overview-page` with per-page padding overrides (Overview `clamp(1.4rem,2.8vw,2.9rem) …`, Portfolio `clamp(22px,2vw,30px)`, Backtesting `26px`, Screener `18px`) plus asymmetric left/right padding (18–24px left vs 28–37px right) | One `.page` container in `src/styles/layout.css` with symmetric inline padding and one shared block offset. Every page starts at the same horizontal alignment |
| **Card + KPI styling** | `dashboard-card` and `kpi-card` duplicated in `components.css` *and* re-overridden per page (Overview `17px 21px`, Portfolio `12px 18px`, Backtesting `14px 20px`, Stock `15px 19px`; card titles 1.32 / 1.4 / 1.42 / 1.47rem) | One card definition driven by tokens; per-page padding and title-size overrides deleted. Pages now only override the tokens they genuinely need (e.g. `--card-body-padding-start`) |
| **Mascot placement** | Each page positioned the mascot absolutely with its own `top`/`right`/`width`/`height` (300px, 400px, 335px, 330px offsets) and the artwork overlapped the first content row | The mascot lives in its own grid track inside `PageHeader`. A negative start margin cancels its extra height, so the header footprint never changes and the artwork can never collide with the first content section |

---

## 2. Design tokens introduced or corrected

New tokens in `src/styles/tokens.css` (overridden once per breakpoint in `src/styles/layout.css`):

```
--page-max-width            1520px
--page-padding-inline       clamp(22px, 1.8vw, 30px)     (symmetric, was asymmetric)
--page-padding-block-start  clamp(26px, 2.4vw, 34px)
--page-padding-block-end    28px
--page-header-height        104px
--section-gap               18px      (was 12 / 13 / 18 / 19 / 20 / 27 per page)
--card-gap                  14px      (was 10 / 12 / 13 / 14 / 16 per page)
--page-header-gap           var(--section-gap)
--card-padding-inline       20px
--card-header-padding-block-start  15px
--card-body-padding-start / --card-body-padding-end  10px / 15px
--kpi-card-min-height       118px     (was 120 / 124 / 104)
--table-head-height         44px      (was 38 / 50)
--table-row-height          40px      (was 39 / 42)
--update-bar-height         48px
--header-art-width / --header-art-height  (one size for all pages)
```

New type scale (was scattered raw values):

```
--font-size-page-title      clamp(2.45rem, 3.15vw, 3.35rem)   → 45.36px @1440
--font-size-page-title-compact / --font-size-detail-title (Stock Analysis)
--font-size-card-title      clamp(1.28rem, 1.55vw, 1.48rem)   → 22.32px
--font-size-kpi             clamp(1.95rem, 2.45vw, 2.32rem)
--font-size-kpi-long        (long values such as "GOOGL 9.0%")
--font-size-table-heading   0.78rem + --letter-spacing-table-heading 0.1em
--font-size-table-cell      0.96rem
--font-size-label / --font-size-meta / --font-size-eyebrow / --font-size-subtitle
--letter-spacing-eyebrow 0.16em / --letter-spacing-subtitle 0.22em
```

Legacy aliases (`--font-size-xs/sm/md/lg/xl`, `--letter-spacing-label`) were kept so existing component rules keep resolving.

---

## 3. Page-specific inconsistencies resolved

**Overview** — header used a 3.5rem title and a 27px header gap; card titles 1.47rem; KPI 120px. Now uses the shared header (45.36px title, 18px gap), shared card title and shared KPI height.

**Screener** — header title was 50.4rem-scale (largest of all pages) with `letter-spacing: -0.03em` and a muted subtitle while the other pages used ink; header margin 12px; mascot at `right: 400px`. Now identical to the other three pages, and the search / filters / export toolbar uses `--card-gap` and `--section-gap`.

**Portfolio** — page padding was `clamp(22px,2vw,30px)` with its own header (`min-height: 112px`, margin 28px) and its own mascot offset; KPI values had a bespoke smaller size for the second card; the summary cards and holdings card each restated card padding and title size; the score pill used a different green than the Screener. All now come from shared tokens, with a single `kpi-card__value--long` variant for the long holding value and one shared positive-soft pill colour.

**Backtesting** — the page used a rigid `104px / 62px / 104px` grid with its own 26px padding and 13px gaps, a smaller title, and its own date formatting. It now uses the shared header height, section gap and card padding tokens, and the date label comes from the shared formatter.

**Stock Analysis** — had its own asymmetric page padding (20px top, 18–24px left vs 22–32px right), a separate `.stock-profile` title style at 600 weight and a different eyebrow size, and its own internal gaps (10px). It now uses the shared container, the shared eyebrow/title/subtitle scale (detail title one step down, same 900 weight), and `--section-gap` between back button → profile → price summary → chart → returns, so the left and right columns start on the same line.

**Settings** — not recreated, not added to the Sidebar. `SidebarNav` still lists exactly Overview, Screener, Portfolio and Backtesting.

---

## 4. Bug found and fixed during QA

`BacktestingPage` declared a local variable named `window` (the sliced backtest window), which shadowed the global `window`. `runBacktest()` therefore called `window.setTimeout(...)` on a plain object and threw, leaving the button stuck on "Running…" and never showing the confirmation toast. The local binding is now `backtestWindow`; the Run Backtest interaction works again.

---

## 5. Verification

Measured with the DevTools protocol (CSS pixels, viewport 1440 × 900). All four main pages are now numerically identical in the header block:

| Page | Header (x, y, h) | Eyebrow y | Title (x, y, size) | Subtitle y | Update bar | First content y |
|---|---|---|---|---|---|---|
| Overview | 229, 34, 104 | 39 | 229, 61, 45.36px | 116 | 1162, 253 × 48 | 156 |
| Screener | 229, 34, 104 | 39 | 229, 61, 45.36px | 116 | 1162, 253 × 48 | 156 |
| Portfolio | 229, 34, 104 | 39 | 229, 61, 45.36px | 116 | 1162, 253 × 48 | 156 |
| Backtesting | 229, 34, 104 | 39 | 229, 61, 45.36px | 116 | 1162, 253 × 48 | 156 |

Computed type scale is identical on every page: page title 45.36px/900, subtitle 11.52px/900/0.22em uppercase, card title 22.32px/900, table heading 12.48px/900/0.1em uppercase, table cell 15.36px, KPI value 35.28px/900, KPI label 16px/800, meta 13.76px/800.

Responsive checks (1440 × 900, 1366 × 768, 1366 × 1024):

* Overview, Screener and Backtesting render inside the viewport with no page-level vertical scroll at 1366 × 768 and 1440 × 900; Backtesting and Stock Analysis keep their fit-to-screen layout at every size.
* Portfolio scrolls at every desktop size because it lists 10 holdings plus pagination — that is content volume, not layout drift (it behaved the same before this change).
* 390 × 844: no horizontal overflow on any page (`scrollWidth` equals the viewport width), titles stay readable, the header mascot is hidden and the content stacks.
* Interaction rules preserved: no hover transform or scale on any control, active Sidebar item stays yellow (`rgb(255, 229, 154)`), inactive items use the warm hover tone, no grey hover surfaces, no new animations.
* `npm run build` passes (Vite 6.4.2 + Sites build preparation) and `npm run test:sites` passes 4/4.
* Browser console: no errors on any page.
* Navigation smoke test: 17/17 checks pass (sidebar navigation, ticker → stock analysis → back, pagination page 2, filter panel open/reset, Run Backtest toast, period control switch).

---

## 6. Evidence

* `screenshots/global-consistency/{page}-{1440x900,1366x768,1366x1024}.png` — all five pages at identical viewport dimensions for direct comparison.
* `screenshots/global-consistency/header-alignment-comparison.png` — the four main headers stacked with guides on the content edge (x = 229), the title top (y = 61) and the first content row (y = 156), showing they line up exactly.
* QA helpers used during the work live in `.qa/` (`shot.mjs` screenshotter, `measure.mjs` geometry probe, `type-check.mjs` type-scale probe, `interaction.mjs` navigation smoke test).

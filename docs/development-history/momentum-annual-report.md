# Top Momentum Column Spacing & Annual Return History — Implementation Report

Two targeted refinements. No redesign, no changes to the design system, no changes to data or calculations.

---

## 1. Overview — Top Momentum column spacing

### What was wrong

Each row was its **own** CSS grid (`grid-template-columns: 30px 52px 64px auto minmax(54px, 1fr)`), so the columns were re-derived per row, the price sat in a content-sized column and the score took the slack. The visible gap between the **sparkline and the price was ~48 px**, while the price and the score pill were almost touching — the spacing was not distributed.

### The fix

**One shared grid for the whole card.** The five rows are now `display: contents`, so all 25 cells participate in a single grid owned by `.top-momentum-list`. Every row therefore uses exactly the same column widths by construction.

```css
.top-momentum-list {
  display: grid;
  grid-template-columns: 40px 58px 82px 62px minmax(56px, 1fr);
  column-gap: 14px;
  row-gap: 3px;
  grid-auto-rows: 34px;
  align-items: center;
}
.momentum-row { display: contents; }
```

* Column order is unchanged: **Rank · Ticker · Sparkline · Price · Momentum Score**.
* Every column has a defined width; there is no `1fr` column between the sparkline and the price and no `space-between`.
* One consistent **14 px** column gap (12 px compact, 8 px on small screens), scaled with the card width.
* The graph is **centred inside its own column** (`justify-self: center`) at a fixed **68 px** visual width (60 px compact, 52 px small) and keeps its natural aspect ratio (`height: auto` with the 100 × 26 viewBox) — it is never stretched.
* The price column is right aligned, the score pill is right aligned in the last track, and the rank badge is centred in its track.
* Row heights (34 px), ticker weight, rank badges, price alignment and score pill styling are untouched; the card dimensions do not change.

### Measured at 1440 × 900

| Gap | Before | After |
|---|---|---|
| Rank → Ticker | 20 px | 20 px |
| Ticker → Sparkline | 18 px | 21 px |
| **Sparkline → Price** | **48 px** | **21 px** |
| Price → Score | 8 px | 14 px |

The spread between the widest and narrowest gap fell from 40 px to 7 px, the sparkline→price gap is less than half its old size, and the price and score stay a tight, coherent pair. All five rows align exactly: every score pill ends at x = 1393 and every price at x = 1304.

---

## 2. Backtesting — Annual Return shows the five most recent years

### What changed

* The window now keeps the **five** most recent calendar years inside the selected backtest period instead of four (`slice(-5)`).
* The years are derived from the active window, so they follow the selected start/end dates and the range control automatically.
* **The running year is labelled YTD.** If the window ends before 31 December of its final year, that year is incomplete and its cell reads `2026 YTD` instead of presenting a partial year as a completed one.
* Future years cannot appear — rows are filtered to `firstYear … lastYear` of the window, and the last year is never later than the current calendar year.
* All three series (Strategy / SPY / SPMO) come from the same annual row, so they always cover matching calendar periods.
* A missing value renders as `—` rather than a fabricated number.
* The card gets a slightly larger share of the right column (`0.85fr / 1.15fr` instead of `1fr / 1fr`) so the fifth row fits without clipping — no text was shrunk and no card was redesigned.

### Verified

| Window | Rows shown |
|---|---|
| Default (ends 2026-11-11) | 2022, 2023, 2024, 2025, **2026 YTD** |
| End date changed to 2024-06-30 | 2020, 2021, 2022, 2023, **2024 YTD** |

Values stay right aligned, positives green, negatives red, row heights and dividers are unchanged, and the five rows fit inside the card at 1440 × 900 and 1366 × 768.

---

## 3. Quality assurance

* `npm run build` passes; `npm run test:sites` passes 4/4.
* Interaction/QA suite now **42/42 pass**, including the new checks: five annual rows, the five most recent years, the YTD flag, no future years, all three series populated, five Top Momentum rows, identical price/score alignment, compact sparklines and an even gap spread.
* **No console errors** on any page.
* Layouts verified at 1440 × 900, 1366 × 768, 1366 × 1024 and 390 × 844 — no horizontal overflow anywhere.

## 4. Evidence

* `screenshots/global-consistency/detail-momentum-and-annual-return.png` — both components side by side.
* `screenshots/global-consistency/overview-{1440x900,1366x768,1366x1024}.png`
* `screenshots/global-consistency/backtesting-{1440x900,1366x768,1366x1024}.png`
* `screenshots/global-consistency/all-pages-1440x900.png`

# Stock Name Overflow & Top Momentum Column Spacing — Implementation Report

Two focused corrections. No redesign, no data changes, no changes to the established design system.

---

## 1. Stock Analysis — long company names

### What was wrong

The mascot duo in the Stock Analysis header was an **absolutely positioned overlay** pinned to the right edge of the profile row, and the title row ran underneath it:

```
Hewlett Packard Enterprise Comp…   ← text ran past its box, under the mascot
```

Measured before the fix (HPE): the heading box ended at x = 887 while the mascot artwork occupied x = 791–959, and the ticker badge (x = 901–959) sat **inside** the mascot's box. The name overlapped the decoration and the badge sat under it.

### The fix

**The mascot now owns a lane in the flex row instead of floating over the text.**

```css
.stock-profile { display: flex; align-items: center; gap: 16px; }
.stock-profile > .mascot-svg { flex: 0 0 auto; }
.stock-profile__copy   { flex: 1 1 auto; min-width: 0; }
.stock-profile__art    { flex: 0 0 auto; width: 168px; height: 124px; }
```

Because the artwork is a real flex item, the copy can never grow into it — the constraint is structural, not a magic padding. The heading keeps its existing size and weight and truncates with an ellipsis:

* `h1` keeps `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`, and is now explicitly `flex: 0 1 auto` so it shrinks instead of pushing the badge.
* The ticker badge stays `flex: 0 0 auto` — it can never shrink or be clipped, and keeps its pastel-yellow pill shape and spacing.
* The full company name is exposed in a `title` tooltip on hover, so nothing is lost to the truncation.
* Below 680px the mascot is hidden and the name is allowed to **wrap naturally** rather than being cut into an unreadable fragment.

**Company names in the data are untouched** — only the display is constrained.

### Verified across name lengths (1440 × 900)

| Stock | Company name | Truncated? | Name ends | Badge starts | Mascot starts | Overlap? |
|---|---|---|---|---|---|---|
| HPE | Hewlett Packard Enterprise Comp | yes (380 px of 649 px) | 703 | 717 | 791 | none |
| NVDA | NVIDIA | no | 467 | 481 | 791 | none |
| GOOGL | Alphabet | no | 490 | 504 | 791 | none |
| BRK-B | BRK-B | no | 444 | 458 | 791 | none |

The badge is fully visible in every case (`scrollWidth` never exceeds its box), and at 390px "Hewlett Packard Enterprise Comp" wraps to two lines with no overflow.

---

## 2. Overview — Top Momentum column spacing

### What was wrong

The row used `30px 52px 64px auto minmax(54px, 1fr)`: the price sat in a content-sized column and the score took the slack, so a wide empty gap opened up **between the price and the score pill**, while the sparkline was stretched by `width: 100%`.

### The fix

A single controlled grid, with every column given a defined width:

```css
.momentum-row {
  grid-template-columns: 36px 72px 80px minmax(80px, 1fr) 58px;
  gap: 8px;
}
```

* **Rank** 36px, **Ticker** 72px, **Sparkline** 80px — all fixed, so every row lines up identically.
* **Price** takes the flexible column and is right-aligned, so it sits directly beside the score with the standard 8px column gap.
* **Momentum Score** is a fixed 58px column and the pill fills it, keeping every pill identical and flush with the card's right edge.
* The sparkline is a fixed **80px** mini-chart at its natural aspect ratio (`height: auto`, so the 100 × 26 viewBox keeps its shape) — it no longer stretches.
* Compact (≤830px height) and small-screen breakpoints scale the same structure down (`32px 62px 68px … 52px` and `28px 48px 56px … 48px`).

Row heights, typography, colours, rank badges, ticker weight, price alignment and the card dimensions are unchanged.

### Verified (1440 × 900, all five rows identical)

| Measure | Value |
|---|---|
| Sparkline width | 80 px (21 px tall) |
| Price right edge | 1327 px — identical in every row |
| Score pill | x 1335 → 1393, 58 px wide, identical in every row |
| Price → score gap | **8 px** (the standard column gap) |

---

## 3. Quality assurance

* `npm run build` passes; `npm run test:sites` passes 4/4.
* Navigation/interaction suite: 31/31 pass, **no console errors** on any page.
* Checked at 1440 × 900, 1366 × 768, 1366 × 1024 and 390 × 844 — no horizontal overflow anywhere; the desktop pages still fill the viewport exactly as before.
* No data, calculation, ranking or portfolio code was touched.

## 4. Evidence

* `screenshots/global-consistency/detail-stock-name-and-momentum.png` — the long-name profile and the Top Momentum rows side by side.
* `screenshots/global-consistency/{overview,stock}-{1440x900,1366x768,1366x1024}.png`
* `screenshots/global-consistency/all-pages-1440x900.png`

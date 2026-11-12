# Mobile UI Refinement — Overview & Model Portfolio Banner Mascot

Two mobile-only refinements. Desktop (≥ 1200px) and tablet (768–1199px) are untouched — the 1440 × 900 Overview render is **pixel-identical** before and after this work.

---

## 1. Mobile Update Bar — hidden completely

At phone widths the whole `.update-bar` is removed from the flow — no dot, no `Updated` label, no date, no refresh button, and no replacement status element:

```css
@media (max-width: 767px) {
  .page-header__controls .update-bar { display: none; }
}
```

The refresh machinery itself is untouched: the provider still refreshes on its interval and the desktop/tablet pill still works exactly as before.

## 2. KPI cards — two columns, no mascots, one-line labels

* The KPI grid becomes **two equal columns** on phones (the third Overview card spans both columns so the row never looks unbalanced).
* Cards use tighter internal padding (`11px 13px`), a 92px minimum height, a slightly smaller label (0.82rem) and an 18px icon, so every label sits on **one line**.
* **Decorative mascots are hidden** inside KPI cards on mobile (`.kpi-card__mascot { display: none }`) — financial information always wins over decoration. They remain on desktop and tablet.
* Where a label would wrap, a phone-only short label is used. `KpiCard` gained an optional `shortLabel`; the full label stays visible by default and the short one only appears under 767px:

| Desktop label | Phone label |
|---|---|
| Sharpe Ratio | **Sharpe** |
| Maximum Drawdown | **Max Drawdown** |

* Secondary text that adds nothing on a small screen (KPI sample captions, KPI detail lines) is hidden on phones.

## 3. Cumulative return chart — a real mobile configuration

The chart now picks its configuration from the space it actually has (`width < 520px` ⇒ compact mode) instead of being a squeezed desktop chart:

| | Desktop | Phone |
|---|---|---|
| Right-side endpoint callout pills | shown | **removed** (no pills, no leader lines) |
| Plot right gutter | 92px | **10px** — the plot uses the full card width |
| Y-axis ticks | 6 | **3** (every other tick) |
| X-axis labels | 12 months | **every other month** |
| Axis text | 12px | **10px**, still legible |

The three series (Strategy / SPY / SPMO) keep their yellow, blue and purple lines and their compact one-row legend with the coloured dots. The range selector stays a compact segmented control (1Y / 3Y / 5Y / All) in the card header, so it never eats chart width. The chart still renders at 1:1 CSS pixels, so nothing is scaled or distorted.

Top Momentum keeps the same five-column grid as desktop, with the score pill back at a compact fixed width so it does not stretch across the card.

## 4. Mobile information density

The page now reads, top to bottom: KPI cards → Performance chart → Top Momentum → Sector Allocation → Model Portfolio banner. On phones the two desktop columns are flattened into a single flow and the Model Portfolio banner moves to the end, where it works as the closing card. No new copy, disclaimers or decorative labels were added.

## 5. Model Portfolio banner mascot — both eyes visible

The mascot was clipped by the banner's bottom edge on phones (only part of the white body showed, the eyes were cut off). The artwork itself is unchanged — same SVG, same proportions, nothing stretched or removed — it was simply positioned too low:

| | Before | After |
|---|---|---|
| Phone position | `bottom: -90px` | **`bottom: -58px`** |

The duo's eyes sit at 184/390 of the artwork height, so raising the artwork by 32px puts the whole face inside the yellow card. The mascot keeps peeking over the lower-right edge exactly like the desktop version, now with both eyes clearly readable, and it still clears the "MODEL PORTFOLIO" label, the "100 Holdings" heading and the circular arrow button.

## 6. Quality assurance

* New `.qa/mobile-test.mjs` — **33/33 checks pass** across 375px, 390px and 430px: update bar hidden, no horizontal overflow, KPI cards in two columns, KPI mascots hidden, labels on one line, no endpoint pills, all three series present, the chart using > 95% of the card width, readable axis text, the banner mascot's eyes inside the card, and the banner ordered last.
* `npm run build` passes; `npm run test:sites` passes 4/4; the navigation/interaction suite passes with no failures and no console errors; the CSV export test still passes 24/24.
* **Desktop unchanged:** the 1440 × 900 Overview is pixel-identical to the pre-change capture; at 1024px (tablet) the Update Bar is still present and the layout is unchanged.

## 7. Evidence

* `screenshots/global-consistency/mobile/overview-{375px,390px,430px}.png` — the full mobile Overview at all three widths.
* `screenshots/global-consistency/detail-mobile-before-after.png` — before and after.
* `screenshots/global-consistency/{overview,backtesting}-{1440x900,1366x768,1366x1024}.png` — desktop and tablet, unchanged.

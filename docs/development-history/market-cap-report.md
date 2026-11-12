# Market Cap on Screener and Stock Analysis — Implementation Report

**Scope:** the Screener table, the Stock Analysis price summary card, and one shared formatting utility. Nothing else was touched.

---

## 1. Data — the provider already supplies it

The configured provider (Yahoo Finance via `yfinance`) returns a **total** market-capitalization field in its quote payload, and the data service already forwards it as a numeric USD amount:

* `data-service/app/providers/yahoo.py` → `market_cap=_num(info.get("marketCap"))` (Yahoo's total market cap, *not* a float-adjusted figure).
* `data-service/app/snapshot.py` → `"marketCap": quote.get("market_cap")` for the stock list, and the same value is carried on the per-ticker detail payload.

So **no data-model change was needed**. Both pages read the identical field:

| Endpoint | Field | NVDA example |
|---|---|---|
| `GET /api/snapshot` → `stocks[].marketCap` | number (USD) | `4280780062720.0` |
| `GET /api/stock/NVDA` → `marketCap` | number (USD) | `4280780062720.0` |

Verified equal for the same ticker, so clicking a ticker in the Screener always opens a Stock Analysis page showing the same market cap. Nothing is hardcoded, randomised or mocked; when a provider returns no value the field is `null` and the UI renders `—`.

**Portfolio was not touched.** It keeps using the float-adjusted market cap and the existing weighting formula — the API still returns 100 holdings, weights summing to exactly `100.0`, a `9.0` single-name cap, and the `floatAdjustedMarketCap` field per holding.

---

## 2. Shared formatting utility

New `frontend/src/utils/format.js` → `formatMarketCap(value)`, used by both pages:

| Input | Output |
|---|---|
| `3_000_000_000_000` | `$3.00T` |
| `850_400_000_000` | `$850.4B` |
| `42_600_000_000` | `$42.6B` |
| `950_000_000` | `$950M` |
| `null` / `undefined` / `NaN` / `≤ 0` / non-number | `—` |

Precision is fixed per unit (T: 2 decimals, B: 1, M: 0). Unit-tested against all of the above plus the invalid cases — 12/12 pass.

---

## 3. Screener

New **`MARKET CAP`** column between **COMPANY** and **PRICE**. Final order:

`# · TICKER · COMPANY · MARKET CAP · PRICE · 1D CHANGE · 12–1 MOMENTUM · SCORE · SECTOR`

* It is an ordinary column: the shared `stock-heading` typography, the shared secondary heading colour (`rgb(109, 105, 100)`), **no yellow highlight**, no special background — verified in the automated QA.
* Values are right-aligned and use tabular numerals; the heading is right-aligned to match them (`.screener-table th.stock-heading--market-cap`, needed for specificity over the shared `th` rule).
* Column widths were rebalanced so the new column fits without squeezing SECTOR (sector names still render in full): rank 4.5%, ticker 9%, company 16%, **market cap 11%**, price 8.5%, 1D change 13%, momentum 14%, score 9.5%, sector 14.5%.

**Sorting** — Market Cap uses the same sortable-column mechanism as every other column: the same caret indicator, `aria-sort`, and a click that toggles ascending/descending. Sorting runs over the complete eligible dataset (the full filtered array is sorted before pagination slices it), not just the visible page. Stocks with no market cap are kept last in *both* directions rather than sorting as zero. Search, filters, pagination and the Top 100 / Top 20% switch are unchanged, and the Momentum Score, ranking and eligibility rules were not modified.

The column-heading slug is now explicit (`["marketCap", "Market Cap", "market-cap"]`) so the CSS hook stays readable and the existing single-word slugs keep working.

---

## 4. Stock Analysis

The existing **price summary card** now carries four groups:

```
$402.84   +$13.29 (+3.41%)   │  ▤ MARKET CAP   $44.9B  │   ♛ Rank #1
```

* Market Cap sits **between the daily change and the ranking badge**.
* Two-line presentation — a small stacked-layers icon, the label `Market Cap` and the value — matching the supplied concept image.
* Subtle 1px vertical dividers separate the groups; the second divider takes the slack so the ranking badge stays pinned to the right edge.
* The price remains the largest element, the daily change keeps its green/red pill, and the card's height and rounded appearance are unchanged (the new group is shorter than the price line).
* No second Market Cap card was created, and nothing was added to the Momentum Analysis card.

**Responsive:** at ≤680px the card becomes a two-column grid — price + change on the first row, Market Cap bottom-left and the rank badge bottom-right — so all four metrics stay visible with no overlap and no horizontal overflow.

---

## 5. Verification

Automated interaction/QA suite (`.qa/interaction.mjs`), now **31/31 pass**, including the new Market Cap checks:

* Column order is exactly `# Ticker Company Market Cap Price 1D Change 12–1 Momentum Score Sector`.
* Market Cap heading background is transparent (no yellow highlight) and uses the shared heading colour.
* Market Cap values are right-aligned.
* Clicking the heading toggles `aria-sort` ascending → descending and changes the row order; all ten rows stay populated; sorting survives an active search term.
* Pagination still reports `Showing 11–20 of 108`.
* Clicking a ticker opens Stock Analysis and the Market Cap shown there is **identical** to the Screener value (`$5.16T` for the tested ticker).
* Portfolio still exposes the float-adjusted market cap column.
* No console errors on any page.

Also: `npm run build` passes and `npm run test:sites` passes 4/4. Layouts were checked at 1440 × 900, 1366 × 768, 1366 × 1024 and 390 × 844 — no horizontal overflow anywhere, and the desktop pages still fill the viewport exactly as before this change.

---

## 6. Evidence

* `screenshots/global-consistency/screener-{1440x900,1366x768,1366x1024}.png`
* `screenshots/global-consistency/stock-{1440x900,1366x768,1366x1024}.png`
* `screenshots/global-consistency/all-pages-1440x900.png` — all five pages together.

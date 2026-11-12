# Portfolio Holdings CSV Export & Dynamic Rank Badge Colours

Two independent features. Portfolio weighting, Momentum Score and ranking logic were not touched.

---

## 1. Portfolio Holdings — CSV export

### The button

`Export` lives in the **Holdings card header**, on the same row as the title: the title stays left aligned, the button sits on the right, drawn as a white rounded pill with a subtle shadow, a download icon and the existing secondary-button typography.

```jsx
<DashboardCard
  title="Holdings"
  className="portfolio-holdings-card"
  action={(
    <AppButton variant="secondary" icon={DownloadSimple} className="portfolio-export-button" onClick={exportHoldingsCsv} disabled={isExporting}>
      Export
    </AppButton>
  )}
>
```

The button lives in the card header's own space — the table columns and their proportions are unchanged.

### The export

The export reads the **complete holdings dataset** (`portfolio.holdings`, 100 rows) from the market payload, never the ten rows currently rendered on the page, so it is independent of pagination, sorting and the current page. It works for whichever portfolio is selected (Top 100 / Top 20%) and always matches the portfolio shown on screen.

| Column | Source | Exported as |
|---|---|---|
| Rank | `holding.rank` | integer |
| Ticker | `holding.ticker` | text |
| Sector | `holding.sector` | text |
| Momentum Score | `holding.score` | number (2 dp) |
| Float-Adjusted Market Cap (USD) | `holding.market_cap` | **full numeric USD value** (e.g. `107674025984`) |
| Raw Weight (%) | `holding.rawWeight` | number (e.g. `0.22`) |
| Final Weight (%) | `holding.finalWeight` | number (e.g. `0.27`) |

The market cap is the same float-adjusted figure the portfolio construction weights on — the display string `$108B` is never used — and weights are exported without a `%` sign so they stay numeric in Excel, Google Sheets and pandas.

### Sort order

The exported file is sorted by **Final Weight, descending** — the largest position first, the smallest last — across the complete holdings dataset, independent of what the on-screen table shows.

* The exported `Rank` column is recalculated sequentially from **1 to N** in that sorted order.
* Holdings with an identical final weight keep their **original portfolio order** (a stable sort with the source index as the tie-breaker).
* The portfolio weights and the portfolio's own ranking are never modified: the sort works on a copy, and the on-screen Holdings table keeps its own sorting and pagination untouched.

### File

* Name: `US_Momentum_Portfolio_YYYY-MM-DD.csv`, built from the actual export date.
* UTF-8 **with BOM**, so Excel opens it as UTF-8 instead of guessing the code page.
* Correct quoting/escaping for commas, quotes and line breaks; no blank rows, no markup, no summary text.
* **Formula-injection safe**: a text field starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with an apostrophe so an imported value can never execute as a formula. Numbers are written as numeric literals and are not affected.

### Validation before the file is written

`validatePortfolioForExport()` checks the portfolio against its own underlying values — never against the rounded UI labels:

* all expected holdings present (count matches `validation.holdingCount`),
* no duplicate tickers,
* ranks are valid integers, tickers present,
* score, market cap and both weights are finite numbers,
* total final weight ≈ 100% (±0.05 for rounding),
* no position above the 9% single-name cap (parsed from the portfolio's own constraint rule),
* no sector above the 35% sector cap (also cross-checked against the backend's `sectorsAtOrBelowCap` flag).

If any check fails the file is **not** written and the values are not silently corrected — the reason is reported in a short toast.

### Behaviour

One click → validate → build → download → a short success toast (`Exported 100 holdings to US_Momentum_Portfolio_2026-11-12.csv`). While the file is being generated the button is disabled (its dimensions do not change), so repeated clicks cannot start overlapping exports. Failures show a concise toast and allow a retry — no banners, no new animations.

### Verified end-to-end (`.qa/export-test.mjs`)

The test drives the real button in a browser, captures the downloaded file and inspects it — **16/16 checks pass**: correct filename with today's date, UTF-8 BOM, the exact seven-column header, **100 data rows**, no duplicate tickers, ranks 1–100, a full numeric market cap, numeric weights without `%`, total final weight 100%, max position ≤ 9%, sector weights ≤ 35%, and the success toast. The test also switches to another pagination page first to prove the export ignores the visible slice.

A sample of the produced file is included at `screenshots/global-consistency/sample-export/US_Momentum_Portfolio_2026-11-12.csv`.

---

## 2. Stock Analysis — dynamic rank badge colours

The rank badge now reflects the stock's **percentile position inside the eligible universe** — the same universe and the same ranks the Screener lists.

| Tier | Condition | Background | Text |
|---|---|---|---|
| Top 20% | `rank / universe ≤ 0.2` | `#DDF3E5` | `#16864A` |
| Middle 60% | `≤ 0.8` | `#FFE59A` | `#735500` |
| Bottom 20% | `> 0.8` | `#FCE4E6` | `#D64545` |
| Unknown | missing/invalid rank or universe | `#EFECE7` | secondary grey |

With the current 108-stock universe: ranks 1–21 green, 22–86 yellow, 87–108 red — rank #1 green, #10 green, #50 yellow, #100 red, exactly as specified.

Everything else about the badge is preserved: the pill shape, its 42px height and padding, the typography, the crown icon for rank #1 and the position in the price summary card. Only the background and text/icon colours change, and the icon now inherits the tier colour. The tier is recalculated whenever the selected stock, the universe or the ranking changes, and it is derived from the rank — not from price performance or the Momentum Score.

---

## 3. Quality assurance

* `npm run build` passes; `npm run test:sites` passes 4/4.
* Navigation/interaction suite: **44/44 pass**, including the new checks — export button present in the Holdings header, right of the title, with a download icon and a stable size; rank badge carries a tier class and the tier matches the percentile computed from the Screener's universe.
* CSV export test: **16/16 pass**.
* **No console errors** on any page.
* No portfolio weighting, Momentum Score, ranking or pagination behaviour was changed.

## 4. Evidence

* `screenshots/global-consistency/portfolio-{1440x900,1366x768,1366x1024}.png` — the Export button in the Holdings header.
* `screenshots/global-consistency/stock-{1440x900,1366x768,1366x1024}.png`.
* `screenshots/global-consistency/detail-export-button-and-rank-tiers.png` — the button plus the three badge tiers.
* `screenshots/global-consistency/sample-export/US_Momentum_Portfolio_2026-11-12.csv` — a real export produced by the button, sorted by final weight (GOOGL 9.0 first, CAG 0.02 last).

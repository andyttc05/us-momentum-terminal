# Tasks 28 And 29: Implementation Report

Date: 12 November 2026  
Latest data as-of: 11 November 2026

> Historical stage note: this report records the 308-symbol expansion. Task 31 later reduced the
> live scan to 200 total symbols (198 eligible). Use
> `docs/TASK_31_33_IMPLEMENTATION_REPORT.md` for current counts.

## Outcome

- Live source universe: **308 unique stocks**.
- Successfully scanned: **308**.
- Fully eligible and scored: **306**.
- Top 100: **100 stocks**.
- Top 20%: **62 stocks** (`ceil(306 × 0.20)`).
- Portfolio: **100 holdings**, fully invested, with all constraints passing.
- Browser first load during a background rebuild: cached data returned in approximately **0.04 s**.
- Fully populated local rebuild: **5.3 s**.
- Browser console: no warnings or errors.

## Screener Root Cause

The momentum `<td>` used `display: flex`. That overrides normal table-cell layout and allows the
sparkline wrapper to become detached from the table row geometry during short result sets.

The table also used `height: 100%`, causing a one-row search result to stretch over the remaining
card height. Search used the Top 100 subset and a raw substring test, so:

- `NVDA` outside the top 100 could disappear;
- `FRT` could match because “Investment” contains `nv`;
- explicit sorting could override search relevance.

## Screener Fixes

- Restored the momentum column as a real table cell.
- Added an inner flex wrapper for the sparkline and momentum value.
- Removed forced table-height stretching; all rows now use the shared compact row height.
- Added explicit vertical centering for every cell.
- Search now covers the full eligible universe while the unfiltered table still honors Top 100 and
  Top 20%.
- Matching priority is exact ticker, ticker prefix, ticker substring, company prefix, company
  word-prefix, then company substring.
- One- and two-character searches no longer match inside unrelated words.
- Search relevance is the primary ordering; the selected column sort applies within equal relevance.
- Stable ticker React keys remain in use.

Measured desktop alignment at 1440px: every visible row was **41px** high and every sparkline
wrapper’s vertical center exactly matched its row center.

## Drawdown Axis

The previous interval algorithm produced one interval for a 40% drawdown, leaving only `0%` and
`-40%`.

The new zero-anchored axis:

- displays `0, -10, -20, -30, -40%` for a 40% drawdown;
- keeps 10-point intervals through 50%;
- chooses rounded intervals for larger ranges;
- includes the actual maximum drawdown marker and callout;
- uses all labels on desktop and mobile so intermediate labels are not dropped.

Tests cover 30%, 40%, 50%, zero, and larger drawdown ranges.

## Universe Expansion

### Source

The existing audited core contained 109 symbols; delisted WBA was removed. The remaining 108 were
combined with 200 common stocks selected across all eleven GICS sectors from the public S&P MidCap
400 constituent snapshot. Exchange tags were checked against Nasdaq Trader's official
`nasdaqlisted.txt` and `otherlisted.txt` files.

The additions are not arbitrary ticker strings: company names, sectors, exchange membership and
live provider fields are retained, and each symbol must independently pass the unchanged live
filters.

### Eligibility

The following rules remain unchanged:

- US-listed common stock.
- NYSE, NASDAQ or NYSE American.
- At least $5.
- At least 210 trading observations.
- At least $2 million average daily dollar volume over 63 sessions.
- 253 valid adjusted observations for the complete 12-1 momentum window.

No price, history or liquidity threshold was reduced.

### Rejected Or Missing Records

- `WBA`: delisted record removed from the live source list.
- `TSM`: ADR, excluded from the common-stock universe.
- `PARA`: provider symbol history was reused by a later unrelated company; current price is below
  $5 and it is excluded.
- No duplicate ticker survived in the live universe.

The current publication has no missing prices or market caps among its 306 eligible stocks.

## Fetching Reliability

### Root Causes

- The former universe was only 109 symbols.
- The primary provider received one large multi-symbol request.
- Missing symbols fell back largely sequentially across providers.
- Stooq is unadjusted and blocked in the audited environment, but could still add a long failover
  wait even though its response could never be scored.
- A stale publication could not be returned while a new build was in progress.
- The frontend treated the initial `503 warming` response as an error.
- Full fundamentals metadata was requested with the same weight as lightweight quote metadata.

### Improvements

- History runs in 40-symbol batches with two controlled batch workers.
- Missing or unadjusted batch rows use a separate four-worker recovery pool.
- Transient failures allow two retries with exponential backoff; permanent no-data/auth/blocked
  failures do not retry.
- Provider requests use the configured timeout.
- Duplicate symbols are removed before fetching.
- Stooq is no longer in the default scoring chain; it remains available as an optional adapter.
- Expired caches are retained as marked fallback data.
- Fast quote metadata and full float fundamentals are separate phases.
- Full float fundamentals are requested only for the best 140 portfolio candidates.
- The browser receives stale/current cached data immediately while the server rebuilds in the
  background.
- The release includes the last fully verified 306-stock publication as a seed. A new Render process
  serves that seed with a `cached` label while its live refresh runs, so an empty disk cache no
  longer produces a blank waiting screen.
- With no cache, the API returns a lightweight warming payload with HTTP 200 instead of a technical
  503 error.
- The frontend polls during warming and stops when the build succeeds or fails.
- Snapshot, detail and publication writes retain the existing atomic JSON-cache behavior.

### Measured Timing

| State | Result |
|---|---:|
| First snapshot with stale cache or bundled verified seed during rebuild | ~0.04 s |
| Fully populated-cache rebuild of 308-stock scan | 5.3 s |
| First expanded scan while downloading new bars/quotes | 241.6 s total background work |
| Warm-cache intermediate rebuild before all fundamentals were populated | 96.2 s |

The 241.6-second first expansion is provider-bound and not directly comparable to the former
109-stock workload. The important user-visible improvement is that the browser no longer waits for
that work: it renders cached data immediately and updates when the background publication finishes.

## Notification UI

The oversized dark toast was replaced by a cream compact pill:

- `Updating data…` with small spinner;
- `Data updated` for a brief manual-refresh success;
- `Some data unavailable`;
- `Cached data`;
- `Service unavailable`, with compact Retry and Dismiss.

Technical backend text is never rendered in the UI. Errors, partial data, cached state and loading
are distinguished in the update bar and notification state. Repeated refresh requests share one
notification, and page-specific duplicate “provider re-checked” toasts were removed.

## Historical Backtest Integrity

The live scan now contains 306 eligible stocks, but the backtest remains on the previously audited
108-symbol core. Today's 200 mid-cap additions are not inserted into historical universes.

The semiannual signal months, next-session execution, adjusted closes, equal-weight research proxy,
0.10% transaction cost and 0% risk-free assumption are unchanged.

## Test Results

| Test | Result |
|---|---|
| Python unit tests | 12 passed |
| Frontend/Sites tests | 16 passed |
| Live data verification | PASS |
| Production Vite build | PASS |
| Search exact/prefix/company/no-result/clear | PASS |
| Search + sorting, filters and pagination | PASS |
| Top 20% count and pagination | PASS: 62 stocks across 7 pages |
| Sparkline row alignment | PASS: exact vertical centers |
| Drawdown dynamic labels | PASS |
| Desktop and 390px layouts | PASS |
| Browser console | 0 errors/warnings |

## Deployment

- Commit: `282af4e` (`Serve verified publication during cold starts`)
- GitHub Pages: <https://andyttc05.github.io/us-momentum-terminal/>
- GitHub Actions Pages run: successful for commit `282af4e`
- Render API: <https://us-momentum-data.onrender.com/api/snapshot>
- Public page verification: Overview displayed 308 scanned, 306 eligible and 100 portfolio stocks.
- Public search verification: `nv` returned only NVDA; FRT was not returned.
- While Render's first live refresh is running, the UI labels the seed as `Cached data`, disables
  refresh and automatically updates after the server publishes fresher data.

## Implementation Evidence

- `frontend/src/utils/stockSearch.js`
- `frontend/src/utils/drawdownScale.js`
- `frontend/src/utils/dataStatus.js`
- `data-service/app/universe_expansion.py`
- `frontend/tests/stock-search.test.mjs`
- `frontend/tests/drawdown-scale.test.mjs`
- `frontend/tests/data-status.test.mjs`
- `data-service/tests/test_quantitative.py`
- `data-service/docs/verification.json`
- `data-service/docs/data_quality.json`
- `docs/task28-29-screenshots/search-nv.png`
- `docs/task28-29-screenshots/drawdown-axis.png`
- `docs/task28-29-screenshots/loading-notice.png`

## Remaining Limitations

- The 308-symbol list is broader but is not every US common stock.
- The provider remains unofficial Yahoo Finance.
- Current, not historical, market cap and float shares are used for the live portfolio.
- Historical constituents and delisting returns remain unavailable.
- Full paid-provider cross-validation is still unavailable.

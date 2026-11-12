# Data Audit Report

Audit date: 12 November 2026  
Audit scope: runtime data service, cached provider records and values published to the terminal  
Evidence files:

- `data-service/docs/data_quality.json`
- `data-service/docs/verification.json`
- `data-service/docs/provider_probe.json`

## Executive Assessment

The cached dataset passed the structural checks that could be repeated locally. There were no
duplicate dates, no out-of-order series, no missing adjusted or raw closes, no weekend observations
and no exchange-holiday observations. AAPL and QQQ prices matched the public Twelve Data demo
endpoint exactly on 11 November 2026.

The active scan contains 200 unique US common-stock candidates: the audited 108-symbol core plus 92
sector-balanced additions from the full 200-symbol approved S&P MidCap 400 pool. Yahoo Finance
returned 200 usable series and 198 stocks passed all universe and momentum rules. The dataset is not fully institutional-grade:
Yahoo Finance is an unofficial provider, market caps and float shares are current rather than
point-in-time, and most backup providers were not usable without paid credentials.

The cache contained a confirmed ticker-identity collision for `PARA`: historical Paramount-era
prices were mixed with a later, unrelated company that reused the symbol. `PARA` is excluded by the
live price filter. `TSM` is excluded as an ADR. Delisted `WBA` was removed from the live scan.

## Source Inventory

| Provider | Role | Data type and fields | Frequency and history | Retrieval | Verified limitations |
|---|---|---|---|---|---|
| Yahoo Finance via `yfinance` | Primary | Daily OHLCV, adjusted close, optional dividends/splits; quote name, sector, exchange, currency, quote type, market cap, shares outstanding, float shares, three-month average volume | Daily bars, up to 10 years; quote metadata cached 24 hours | Python client through the FastAPI service | Unofficial API; no contractual SLA; current fundamentals only; occasional malformed or unavailable symbols |
| Twelve Data | Optional backup | Daily OHLCV, quote name, exchange, currency, market cap, shares and float fields when supplied | Provider-dependent; free plan 8 requests/minute and 800/day | API key required | Free plan does not reliably supply adjusted close, so the momentum engine refuses unadjusted series |
| Stooq | Optional backup | Daily OHLCV | Full CSV export | Public CSV endpoint | Unadjusted only; blocked by an anti-bot wall in the audited network; not eligible for scoring |
| Financial Modeling Prep | Optional backup | Daily OHLCV with adjusted close; quote fields | Provider-dependent; documented 250 requests/day | API key required | Not exercised without a key |
| Alpha Vantage, Finnhub, Polygon | Research only | Not connected to the runtime provider registry | Probe only | Public or demo endpoint | No production adapter in the current service; not sources of displayed data |

Runtime TTLs are 15 minutes for bars while the market is open, 6 hours while closed, 24 hours for
quote metadata, 15 minutes for the publication and 15 minutes for stock detail.

## Core Data Checks

| Check | Result | Evidence |
|---|---|---|
| Historical OHLCV availability | PASS | 311 cached series; 741,051 rows |
| Audit coverage | PASS | 14 Nov 2016 through 11 Nov 2026 |
| Duplicate dates | PASS | 0 duplicate date rows |
| Date ordering | PASS | 0 unsorted series |
| Missing close or adjusted close | PASS | 0 null price rows |
| Weekend/holiday observations | PASS | 0 non-NYSE session dates in the cached bars |
| Single cross-sectional as-of date | PASS | All 198 published stocks ended on 11 Nov 2026 |
| Ticker uniqueness | PASS | No duplicate symbol in the published stock rows |
| Ticker identity consistency | FAIL, corrected | `PARA` mixed two unrelated companies and extreme, implausible returns; current `PARA` is excluded by the $5 minimum-price rule |
| Security-type filter | PASS after correction | ADR `TSM` is excluded; 198 common stocks remain |
| Exchange filter | PASS | Published stocks map to NASDAQ or NYSE; exchange is provider-verified |
| Currency consistency | PASS | 198 published stocks have USD market cap and quote currency |
| Minimum history | PASS | Smallest published history is 694 observations, above the 253-session momentum requirement |
| Three-month dollar-volume filter | PASS | Every published stock clears the existing $2 million threshold |
| Stale prices | PASS at snapshot level | All published stocks share 11 Nov 2026 as-of date |
| Volume anomalies | WARNING | 664 zero-volume rows; most are concentrated in excluded PARA and early, thin SPMO trading |
| Extreme return observations | WARNING | 92 adjusted daily moves of at least 35%; 16 belong to the excluded `PARA` identity collision |
| Corporate-action metadata | WARNING | Refreshed series retain action rows; some older core entries remain incomplete |
| Adjusted-price corporate actions | PASS for sampled securities | NVDA and AAPL split dates show continuous adjusted returns and provider-reported split factors |
| Reverse splits | NOT VERIFIED | No confirmed reverse-split sample in the eligible cached universe |
| Mergers and delistings | WARNING | No point-in-time security master; delisted `WBA` is not in the live scan and other delistings may be missing |
| Benchmark availability | PASS | SPY, SPMO and QQQ populated to 11 Nov 2026 |
| Benchmark cross-check | PASS | QQQ open/high/low/close/volume and date matched Twelve Data exactly; AAPL also matched |
| Trading calendar | PASS after correction | NYSE calendar now handles holidays and early closes |

## Corporate Actions And Price Convention

The strategy uses adjusted closing prices only. The frame builder no longer substitutes an
unadjusted close when an adjusted close is absent; those rows are dropped and the series is flagged
for exclusion where necessary.

The provider returned corporate actions for sampled securities:

- NVDA: 4-for-1 split on 20 July 2021 and 10-for-1 split on 10 June 2024.
- AAPL: 4-for-1 split on 31 August 2020.
- NVDA and AAPL adjusted daily returns remained continuous across the sampled split dates.

The refreshed cached batch files now retain dividend and split fields, while some older core cache
entries still have `null` action fields. This does not invalidate the adjusted close, but action
coverage is not uniform for every legacy row.

Cash dividends are reflected through adjusted closes. Ticker changes, mergers and delistings cannot
be fully reconstructed from the cache without a security master and stable security identifiers.

## Market Cap And Float Review

Two different fields are now kept separate:

1. **Ordinary market cap** is the provider's current total-company market cap. It is displayed in
   Screener and Stock Analysis and is expressed in USD for the published universe.
2. **Float-adjusted market cap** is current provider float shares multiplied by the latest stock
   price. It is used only in the portfolio and is labeled as float-adjusted in the interface and
   export.

The same ordinary market-cap value from the shared snapshot feeds Screener and Stock Analysis, so
those pages are internally consistent. All 100 published holdings had positive float caps and
matched the ordinary market-cap field shown for the same ticker.

Float-share basis warnings were found for GEF, GOOGL, GS, NWSA and TSM, where provider `floatShares`
exceeded `sharesOutstanding`. The difference is plausible for multi-class structures in some cases,
but TSM's ratio was clearly inconsistent with its ADS structure and TSM is excluded as an ADR.
Float shares are not independently verified against a second paid fundamentals provider.

### Market Cap Classification

- Display consistency: **PASS**
- USD normalization for published stocks: **PASS**
- Ordinary market cap usage in portfolio: **PASS after correction**
- Float-share provenance: **WARNING**
- Point-in-time historical market cap: **FAIL / unavailable**
- Independent float-share verification: **NOT VERIFIED**

## Corrections Made

- Added provider security type, float shares, shares outstanding, three-month average volume and
  current quote price to quote records.
- Added a 200-symbol approved mid-cap candidate pool and selected 92 additions with static sector
  quotas, with exchange tags checked against Nasdaq Trader's official listed-security files.
- Added explicit universe eligibility checks for exchange, common-stock type, USD currency, $5
  minimum price, 210 observations and $2 million three-month average dollar volume.
- Separated universe eligibility from the 253-observation momentum-history requirement.
- Excluded ADR `TSM` from the common-stock universe.
- Excluded reused-symbol `PARA` under the live price rule after identifying the data collision.
- Removed delisted `WBA` from the live source universe.
- Replaced ordinary market-cap portfolio weighting with float-adjusted market cap × Momentum Score.
- Corrected the portfolio CSV to write the numeric float-adjusted cap rather than ordinary cap.
- Replaced weekday-only market logic with the NYSE exchange calendar, including holidays and early
  closes.
- Stopped filling missing adjusted closes with unadjusted closes.
- Enforced exclusive use of adjusted closes in backup adapters before a series can be scored.
- Added current cache metadata so action-enabled bar downloads can be distinguished in future runs.

## Remaining Limitations

- The universe is a source list of 200 symbols, not a complete exchange master or a daily scan of
  all eligible US common stocks.
- Yahoo Finance is an unofficial provider without a service-level agreement.
- Current market cap and float shares cannot be applied retrospectively without look-ahead bias.
- The runtime has no point-in-time historical constituents, stable security IDs or delisting
  returns.
- Some older bar-cache entries have adjusted closes but incomplete per-row corporate-action fields.
- Cross-provider verification is limited to public demo symbols unless backup API keys are added.
- The data service keeps historical symbols such as `PARA` in the raw cache. They are excluded from
  the live universe but were not deleted because the records document the provider defect.
- The mobile layout omits the full freshness bar; compact loading, partial, cached and error notices
  remain visible in the viewport.

## Recommended Improvements

1. Use a commercial point-in-time security master and exchange constituents dataset.
2. Use a licensed fundamentals history for shares outstanding and float shares by date.
3. Persist stable security identifiers in every bar and quote record.
4. Retain dividend, split and ticker-change records with each series, not only adjusted closes.
5. Add a paid adjusted-close backup with independent corporate-action data.
6. Add automated anomaly escalation for large returns, ticker identity changes and zero-volume
   runs.
7. Add provider-versus-provider price and market-cap tolerance tests once paid credentials exist.
8. Add a mobile freshness summary so provider status remains visible at all breakpoints.

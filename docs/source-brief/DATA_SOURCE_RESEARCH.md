# Data Source Research

**Reviewed:** 11 November 2026  
**Purpose:** Assess the proposed freely accessible sources before any provider integration. This is a technical and terms review, not legal advice. Website terms and access behavior can change; recheck them before implementation and use.

## Summary

No single proposed source provides a complete, permitted, reliable set of US common-stock membership, adjusted daily OHLCV, historical point-in-time shares/float, and historical sector data.

The most promising parts are:

- **DeltaScreener:** a directly downloadable dated monthly CSV may help bootstrap a current universe snapshot, with attribution and additional filtering. It is active-only and its rows combine third-party providers, so it does not solve point-in-time backtesting or rights for underlying fields.
- **SEC EDGAR:** filing-based facts are public and its `data.sec.gov` APIs need no API key. Filing observations can support point-in-time share-count research if effective dates and filing dates are kept distinct. SEC public-float facts are reported as dollars, not float shares, and coverage is not uniform.
- **Yahoo Finance:** historical OHLCV is a candidate for human-operated inspection/download, but Yahoo’s terms prohibit automated data collection without express prior permission. Do not use yfinance or scrape pages as an automated adapter absent authorization.
- **Stooq:** its history/download pages are a candidate for user-driven CSV import only after terms are confirmed. A direct no-key CSV request returned a JavaScript verification HTML page in the test. Do not bypass the verification.
- **CompaniesMarketCap and StockAnalysis:** useful for manual supplementary comparisons only within their stated use limits; current guidance does not grant general automated reuse/redistribution.

The app should support multiple source adapters and user-supplied CSV imports. A source failure should leave the last valid snapshot visible with stale/failed status; it should not trigger silent fallback to an unapproved source.

## Research and access tests

Tests below were run on 11 November 2026 with ordinary HTTPS requests. No captcha, browser-verification, paywall, or rate-limit control was bypassed.

| Source/test | Result | Interpretation |
|---|---|---|
| DeltaScreener dated CSV and metadata | `GET` returned HTTP 200; CSV content type; metadata reported `asOf=2026-11-03`, 4,894 rows; CSV was 1,610,141 bytes. Header includes ticker, name, exchange, sector, country, price, `mktCap`, and assorted fundamentals/returns. | Technically downloadable without API key. This verifies file availability/schema only, not field accuracy or licensing rights of all upstream data. |
| SEC AAPL companyfacts JSON | `GET` returned HTTP 200 without API key. Sample had 71 `EntityCommonStockSharesOutstanding` observations and 20 `EntityPublicFloat` observations. The latest share-count fact in that response had `end=2026-10-23`, `filed=2026-11-03`; latest public-float fact had `end=2026-03-27`, `filed=2026-11-03`. | Confirms keyless access and the importance of separating measurement date from filing/known date. This is one issuer test, not a coverage audit. |
| Stooq AAPL daily CSV endpoint, no key | `GET https://stooq.com/q/d/l/?s=aapl.us&i=d` returned HTTP 200 but `text/html` JavaScript verification content, not CSV. | Not usable by the tested unattended request. Do not interpret HTTP 200 as data success and do not bypass the challenge. The human download flow and current usage terms still require review. |
| Yahoo Finance history page | An ordinary history-page open through the research browser returned HTTP 429. No CSV export or automated historical-data endpoint was requested. | This confirms access was not available to this research client at that time; it does not establish the site's behavior for a signed-in human user. Yahoo's terms prohibit automated extraction absent prior express permission. Review/download only through a permitted user-driven path unless permission is obtained. |
| CompaniesMarketCap / StockAnalysis direct scraping | No structured data extraction test was performed. Their terms/help guidance does not authorize general automated reuse. | Do not scrape. Manual comparison can be reconsidered within their terms. |

## Source-by-source findings

### Yahoo Finance — historical OHLCV candidate, automation blocked pending permission

- Historical page: [Yahoo Finance AAPL Historical Data](https://finance.yahoo.com/quote/AAPL/history/).
- Terms: [Yahoo Terms of Service](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html).
- Wrapper context: [yfinance project](https://github.com/ranaroussi/yfinance), which states that it is not affiliated with or endorsed by Yahoo Finance and that Yahoo Finance data use is intended for personal use.
- Yahoo terms state that automated access or collection (including robots, spiders, scrapers, data mining, or data gathering tools) requires express prior permission. Therefore, public page visibility or a working unofficial endpoint is not sufficient permission to build an automated collector.
- OHLCV is the relevant data domain, but adjustment semantics, complete universe coverage, survivorship, rate stability, historical CSV export behavior for a signed-in user, and permitted local storage/redistribution were not validated in this review. The ordinary history-page access test returned HTTP 429.
- **Decision:** no automated Yahoo adapter until written authorization and data-use scope are established. A manual download workflow can be evaluated separately; document exactly which fields and adjustment basis the export supplies.

### Stooq — daily OHLCV candidate, access and terms unresolved

- Site: [Stooq historical data](https://stooq.com/db/h/).
- Tested CSV route: [Stooq daily CSV endpoint](https://stooq.com/q/d/l/?s=aapl.us&i=d) (returned a browser-verification HTML response in the automated test, not CSV).
- Daily OHLCV CSV has historically been exposed through the site's download flow. The current direct-access behavior is not dependable in the test environment. Independent current reports describe a JavaScript challenge and key/request restrictions; those reports are not a substitute for Stooq's own terms.
- Official access/usage terms were not independently readable through the research browser due the site verification page. Secondary documentation reports that data may be personal-use-only and redistribution requires consent. Treat usage rights as **unverified**, not granted.
- Price adjustment policy and data correction/quality guarantees were not established. A successful manual CSV export must be checked for split/dividend adjustment behavior, date coverage, symbol suffixes, missing sessions, and license restrictions.
- **Decision:** do not implement challenge circumvention. Consider only a manual CSV import after Stooq terms are reviewed, or a documented permitted interface/access grant is obtained.

### DeltaScreener — monthly universe snapshot candidate

- Dataset page: [Free US Stock Market Dataset](https://deltascreener.com/data).
- Methodology: [Data Methodology](https://deltascreener.com/methodology).
- Dated CSV example: [2026-11-03 universe file](https://deltascreener.com/data/us-stock-universe-2026-11-03.csv).
- Metadata: [Universe dataset metadata](https://deltascreener.com/data/universe-dataset-meta.json).
- The site says it publishes monthly dated files that are not overwritten, and permits free use, including commercial use, with attribution and a link to DeltaScreener. The current file is an active-company snapshot, not a historical point-in-time universe. It includes ADRs and foreign issuers listed in the US and is not guaranteed to exactly match the project's common-stock/exchange scope.
- The site says the file is generated from its screener, with prices/fundamentals drawn from a mix of Financial Modeling Prep, Yahoo Finance, SEC EDGAR, Finnhub, Alpha Vantage, and Polygon. Its method page identifies Financial Modeling Prep as primary and other providers as field-by-field fallbacks. This means different fields may have different providers/timestamps. The underlying third-party terms may constrain derived data reuse even where DeltaScreener grants rights to its published CSV; clarify the applicable scope before storing or redistributing derived values.
- The site provides data as-is without warranty. It says delisted/acquired companies are absent and fundamentals are not restated for amendments. The CSV's `mktCap` should be treated as a provided total-market-cap field unless its own field methodology establishes otherwise; it is not float-adjusted capitalization.
- **Decision:** promising bootstrap/import candidate with attribution and explicit source metadata, but not a sole master source, not a complete history for backtests, and not a source for point-in-time float shares.

### SEC EDGAR — filing and XBRL source

- [EDGAR API overview](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
- [Accessing EDGAR data and fair access](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data).
- [Company facts API](https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json) (Apple example).
- SEC states that the public `data.sec.gov` submissions and XBRL APIs need no authentication or API keys. It provides filer submissions history and standardized taxonomy/company facts, plus bulk archives. SEC's current fair-access guidance sets a maximum request rate of 10 requests/second, requests efficient/moderate retrieval, and requires an identifying User-Agent. The SEC can limit access for excessive or unclassified bot traffic.
- Filing history can support listing metadata, CIK-symbol/exchange mappings, and public filing access. XBRL facts may include `dei:EntityCommonStockSharesOutstanding` and `dei:EntityPublicFloat`; tag presence and continuity vary by issuer and filing. Custom tags and share-class context require special handling.
- A fact includes an observation/period end and filing accession/date. For backtests, the value must not be used before it was filed and available. Preserve both the fact's measurement date and its filed/known date.
- `EntityPublicFloat` is a USD amount that generally represents the aggregate market value of equity held by non-affiliates for a specified reference date. It is not a number of float shares and is not interchangeable with a float-adjusted market cap.
- **Decision:** use as an approved candidate for filing-grounded observations subject to compliant request headers/rate controls and point-in-time rules. It will not by itself supply complete daily shares or public float for every issuer.

### CompaniesMarketCap — manual reference only

- [CompaniesMarketCap Terms of Service](https://companiesmarketcap.com/terms-of-service/).
- [About and market-cap methodology](https://companiesmarketcap.com/about/).
- Its explanation computes market capitalization from share price × total shares outstanding and presents current plus periodic/year-end historical market-cap references for many issuers. Exact history granularity and coverage vary by company and were not audited here. It is a supplementary value for manual reconciliation; it does not make market cap equivalent to float-adjusted market cap.
- Its terms reserve the site's intellectual property and describe an editorial-use exception for sharing/reproducing content with attribution. The reviewed terms do not give general permission for automated extraction or broad programmatic reuse. Data may be delayed, incomplete, or inaccurate.
- **Decision:** no production ingestion. Use as a manual check only where current terms allow; obtain permission before automation or republishing.

### StockAnalysis — manual reference only

- [About the data](https://stockanalysis.com/help/data-and-downloads/about-our-data/).
- [API access FAQ](https://stockanalysis.com/help/faq/api-access/).
- It reports broad symbol coverage and historical fundamentals sourced from providers including S&P Global, Fiscal.ai, Nasdaq Data Link, and Financial Modeling Prep. Free display and downloadable products have different provider/coverage constraints; some providers do not allow data downloads.
- Its help page explicitly says there is no API or programmatic interface and that it has provider licenses to display the data but not redistribute or resell it programmatically.
- **Decision:** no automated extraction or production ingestion. Manual cross-check only if compatible with the site's current terms.

## Data concepts and non-equivalences

| Term | Meaning | Important limit |
|---|---|---|
| Total market capitalisation | Price × total shares outstanding for a defined share class/issuer and timestamp. | Must use point-in-time price and point-in-time share count for historical work. |
| Shares outstanding | Issuer-reported count of issued shares outstanding, under the filing's scope and date. | Not the publicly tradable float; often changes through issuance, repurchases, conversions, splits, and class changes. |
| Public float | SEC-reported aggregate dollar value of equity held by non-affiliates for a specified measurement date. | Not a share count; not automatically usable as float shares or float-adjusted market cap. |
| Float shares | Share quantity considered available to public/investable holders under a named methodology. | Requires its own source and methodology; strategic holders and share classes require consistent treatment. |
| Float-adjusted market capitalisation | Price × point-in-time float shares, or total market cap × a point-in-time free-float factor. | Do not substitute total market cap and label it float-adjusted. |

## Fallback plan

1. Prefer an approved direct-download file or source adapter with documented access, attribution, storage, and redistribution rights.
2. For a blocked or failed source, stop that fetch, keep the latest validated local data, and mark it stale/failed. Do not switch silently to another website or mix provider values without field-level provenance.
3. Allow a user to import CSV files downloaded through a source's permitted website workflow. Preserve original file, URL/source, download timestamp, source-as-of date, terms/attribution metadata, and validation report.
4. Use SEC data for filing-grounded historical facts and record filing dates; where the fact is missing, retain it as missing. Do not fill it from today's value for a historical backtest.
5. Use CompaniesMarketCap or StockAnalysis only as manual QA references under current terms. A mismatch should initiate investigation, not automatic override.
6. If no suitable free source can legally and reliably provide required OHLCV or share/float data, pause that part of the product and present the limitation. Any paid provider or broader usage license requires a separate Product Owner decision.

## Recheck before implementation

- Read each source's then-current terms/robots/access notices and confirm whether automated download, local storage, historical retention, app display, and redistribution are each permitted.
- Run a small-symbol coverage test and compare dates/OHLCV, corporate actions, missing sessions, and adjustment behavior across at least two approved sources.
- Audit universe membership and ticker/exchange/security-type coverage against project rules.
- Measure SEC fact coverage and filing-to-effective-date lag across a representative sample, including ADRs, multiple share classes, and recent corporate actions.
- Record source, dataset version, request time, source-as-of time, license/attribution status, and transformation version for every imported field.

# Open Decisions and Assumptions Register

This register distinguishes Product Owner decisions from research findings. Update each resolved item with the decision, rationale, date, and methodology/configuration version. Do not treat a research candidate as an approved production source.

## Confirmed direction

- Prefer free, publicly accessible downloadable data; avoid paid APIs and API keys where possible.
- Evaluate source restrictions, reliability, coverage, and usage terms before enabling a source.
- Keep provider/source adapters replaceable; do not make the application depend on one website.
- Standard 12–1 month momentum is primary. Do not use a 9-month fallback as standard 12–1 momentum.
- Approximately 13 months of usable prices are required for the standard momentum calculation; download approximately 14 months as a buffer.
- A 13-month minimum trading-history eligibility threshold is proposed, but awaits the Product Owner's final approval.
- Distinguish total market capitalisation, shares outstanding, SEC public-float value, float shares, and float-adjusted market capitalisation.
- Historical market-cap inputs must be point-in-time. Do not use today's share count for a historical date without an explicit look-ahead-bias label.

## Source research status

| Source | Research result | Current status |
|---|---|---|
| Yahoo Finance | Historical OHLCV may be visible/downloadable through the website. Yahoo Terms prohibit automated data collection without express prior permission. yfinance is an unofficial wrapper, not authorization from Yahoo. | Do not implement scraping or automated retrieval unless written permission/access terms are confirmed. Manual website download remains to be tested under permitted access. |
| Stooq | Historical daily OHLCV CSV endpoint tested without a key; response was a JavaScript browser-verification HTML page, not CSV. Independent recent references report access/key restrictions; official terms/access rights remain to be confirmed. | Not currently a dependable unattended provider. Do not bypass its challenge. Re-test only through its permitted download flow or after written access permission. |
| DeltaScreener | Its dated monthly CSV and metadata were downloaded successfully without a key. The source states attribution/link conditions, but also says its universe is active-only, includes ADRs/foreign issuers, and its values combine vendors including commercial providers. | Candidate for a credited monthly snapshot/bootstrap universe, subject to source-rights review and project scope. Not a point-in-time historical universe by itself and not authoritative for the exact common-stock universe. |
| SEC EDGAR | Company-facts JSON was retrieved without an API key. Requires a declared User-Agent and fair-use request limits. Public float and shares outstanding exist as filing facts for some issuers, but values are sparse/inconsistent and have different measurement and filing dates. | Preferred primary source for filing-grounded point-in-time observations where standardized tags/filings exist; not a complete float-shares dataset. |
| CompaniesMarketCap | Website exposes current and historical market-cap reference tables. Its terms restrict content reuse, with a stated editorial-use exception; they do not grant broad automated/programmatic reuse. | Manual supplementary cross-check only, subject to current terms; do not scrape or use as a production feed without permission. |
| StockAnalysis | Its help center says there is no programmatic interface and that it has provider licenses to display data but not redistribute/resell it programmatically. | Manual supplementary cross-check only where permitted; do not scrape or ingest programmatically. |

See `DATA_SOURCE_RESEARCH.md` for links, test details, definitions, and limitations.

## Product Owner decisions still required

| ID | Topic | Open decision |
|---|---|---|
| D-01 | 13-month minimum history | Confirm or reject the proposed change from 10 to 13 months as the basic universe trading-history threshold. The primary momentum calculation itself requires the approximately 13-month price window regardless. If approved, propagate the threshold to `PRODUCT_REQUIREMENTS.md`, `PROJECT_BRIEF.md`, and any settings/UI copy; those unchanged handoff files still contain the original 10-month value. |
| D-02 | Price data source | Choose an approved primary OHLCV source or permitted manual-file workflow. Yahoo automation is prohibited absent permission; Stooq direct retrieval failed the access test. Decide whether the MVP can proceed using manually downloaded files while terms/access are clarified. |
| D-03 | Universe source | Decide whether to use DeltaScreener's monthly CSV as a starting snapshot, after defining filters for common-stock status, exchange, domestic/foreign issuer, ADRs, and other exclusions. Decide what source will cover delisted names for historical tests. |
| D-04 | SEC access scope | Confirm SEC EDGAR as a filing source and the operational User-Agent/contact identity. Decide how much filing-level extraction is in MVP; XBRL coverage will not provide all historical share/float observations uniformly. |
| D-05 | Price series and dividends | Lock split adjustment, dividend adjustment, and price field for momentum, daily volatility, $5 screen, dollar-volume screen, and backtest returns. Do not mix price-return momentum with total-return volatility unintentionally. |
| D-06 | Shares-outstanding point-in-time rule | Choose the permitted as-of convention when a filing's measurement date precedes the filing/publication date. Backtests must use only facts filed/available by the decision timestamp. |
| D-07 | Missing float information | Choose exclude from portfolio construction or use a clearly labelled, point-in-time total-market-cap approximation. Current values may not substitute for historical float/shares in a backtest. |
| D-08 | Float methodology | Select a defensible float-shares/free-float-factor definition and source. SEC public-float dollar value must not be treated as a float-share count. |
| D-09 | Supplemental reference sites | Confirm whether CompaniesMarketCap and StockAnalysis should remain manual QA-only. Automated extraction is not approved by the current terms/help guidance found. |
| D-10 | Sector data | Choose a source/taxonomy (GICS only if supported and licensed) and handling for missing/unknown sectors under the 35% cap. |
| D-11 | Top 20% rounding and ties | Confirm rounding convention, minimum count, and deterministic tie-breaking. The original guide recommends nearest integer and minimum one for a non-empty universe. |
| D-12 | Constraint redistribution | Specify deterministic iterative stock/sector redistribution and precise infeasibility behavior. Preserve the 9% stock and 35% sector limits. |
| D-13 | Backtest timing | Choose rebalance reference/effective dates, execution price/time, and market-calendar convention. |
| D-14 | Costs and Sharpe | Choose transaction costs, slippage, per-side vs round-trip interpretation, and risk-free-rate series/assumption. Screenshot values are placeholders. |
| D-15 | Backtest return basis | Choose portfolio and benchmark price-return vs total-return conventions and dividend treatment so SPY and SPMO comparisons align. |
| D-16 | Historical universe coverage | Assess delisted securities, ticker changes, and point-in-time membership coverage. If unavailable, explicitly limit backtest claims rather than call results unbiased. |
| D-17 | Data rights and retention | Confirm whether the app is personal/educational only or will be shared. Confirm storage, caching, attribution, and redistribution rights for each selected source. |
| D-18 | Refresh cadence | Define exact US market calendar, after-close update time, data publication delay, retries, and March/September effective dates. |
| D-19 | Settings scope | Decide which core-methodology values are read-only descriptions versus editable configuration. Preserve the formula and methodology version. |
| D-20 | Infeasibility UX/API | Define the response status and page states for a portfolio that cannot meet all caps while fully invested. |
| D-21 | Course research question | Student must author and approve the one-sentence question in their own words and reconcile the course instruction to use existing data without collecting it against the proposed data workflow. |

## Existing confirmed strategy defaults

- Exchanges: NYSE, NASDAQ, NYSE American.
- Common stocks only; exclude ETFs, bonds, warrants, and preferred shares.
- Minimum share price: $5; minimum market capitalization: none.
- Three-month average dollar volume: at least $2 million.
- Standard 12–1 momentum; latest month excluded; no 9-month fallback in the primary method.
- Top 100 and Top 20% selection modes.
- Maximum single-stock weight 9%; maximum sector weight 35%; target 100 holdings.
- Fully invested target when constraints are feasible.
- Semiannual March/September official rebalance; daily rank changes do not automatically trade.
- Benchmarks: SPY and SPMO.
- Proposed application stack remains Python/Flask, Pandas/NumPy, SQLite/SQLAlchemy, Jinja/HTML/CSS/JavaScript; scheduler later. Market-data source selection is pending the source review and decisions above.

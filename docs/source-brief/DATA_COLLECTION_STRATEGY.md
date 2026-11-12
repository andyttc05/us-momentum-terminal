# Data Collection Strategy

**Status:** specification only; no collector has been implemented.  
**Related:** `DATA_SOURCE_RESEARCH.md`, `OPEN_DECISIONS.md`, `QUANTITATIVE_METHODOLOGY.md`, `TECHNICAL_ARCHITECTURE.md`.

## 1. Goals and guardrails

Build a repeatable local dataset from free, publicly accessible sources where access and reuse are permitted. Avoid paid APIs and API keys where possible. Use replaceable source adapters, keep every field's provenance, and do not scrape around a site's access controls.

Publicly visible does not automatically mean authorized for automated fetching, local retention, app display, or redistribution. Each source must pass a source review for those separate use cases before its adapter is enabled. See the current research outcomes in `DATA_SOURCE_RESEARCH.md`.

No rankings or historical weights should be produced from a partial or mismatched source batch without visibly recording its data state. Provider fallback must be explicit per field and configuration; there is no silent source switching.

## 2. Separate data domains and source adapters

Do not define one provider as the source of all project data. Use independent adapters behind normalized interfaces:

| Data domain | Initial candidate | Collection form | Current position |
|---|---|---|---|
| Current universe snapshot | DeltaScreener dated CSV | Direct dated-file download or user-imported CSV | Candidate only; filter to project security scope and preserve attribution/source notes. Not point-in-time historical membership. |
| Historical security/master facts | SEC submissions, filings, and other approved issuer/exchange reference data | SEC keyless JSON/bulk data and filing documents; user-imported approved files | SEC is useful for filing facts but is not a complete authoritative exchange security master or delisted archive. |
| Daily OHLCV | Yahoo Finance or Stooq | User-operated site CSV download until automated rights/access are confirmed; otherwise another source with permission | Yahoo automation prohibited absent permission; Stooq endpoint test returned verification HTML. Neither currently approved for an automated collector. |
| Shares outstanding | SEC company facts and source filings | Company facts/filing extraction; retain fact units, context, period, accession, and filed date | Candidate for point-in-time observations where facts are present. Coverage and custom tags need audit. |
| Public float / float shares | SEC filing cover facts plus other explicitly authorized source | SEC filing/XBRL; manual source review | Public float is often a dollar-valued fact, not float shares. No complete float-share source has been approved. |
| Supplementary market cap QA | CompaniesMarketCap, StockAnalysis | Human review/manual comparison only under current terms | Not a programmatic input without source permission. |

Adapters should map source-native fields to the normalized model while retaining raw source values and the parser/schema version. Provider-specific code stays inside each adapter.

## 3. Normalized records and temporal fields

### Security identity

Store a stable internal security identifier plus ticker history. A ticker alone is not a durable identity due to ticker reuse, share-class listings, mergers, and ticker changes. Preserve CIK where available, exchange, share class, security type, country/domicile, active interval, and source identifiers.

### Daily prices

For each observation, store:

- security identifier and source symbol;
- trading date and timezone/calendar basis;
- OHLC and volume as provided;
- adjusted fields only when the source defines the adjustment method (split-adjusted vs dividend-adjusted must not be inferred from a generic `Adj Close` label);
- provider, source file/URL, source-as-of timestamp, download timestamp, and normalization version;
- correction/revision status where the source exposes it.

Do not blend rows from different price sources or adjustment bases in one calculation window without explicitly reconciling them. Preserve raw and normalized values separately.

### Fundamental and share observations

Store at least `observation_type`, `value`, `unit`, `effective_date` or `period_end`, `filed_at` or `known_at`, `accession_number`, share-class scope, issuer/security scope, provider, source document, parser version, and quality status. Never collapse measurement time and public availability time into a single `as_of_date`.

Separate fields for:

- total shares outstanding;
- SEC public-float value in currency;
- source-reported float shares, if any;
- free-float factor, if any;
- total market capitalisation;
- float-adjusted market capitalisation.

Derived market cap requires a price and share/float observation whose timestamps and share-class scopes are aligned. Store the formula, selected observation IDs, and any stale/look-ahead warnings with the derived value.

## 4. Standard 12–1 price history window

The primary momentum method uses standard 12–1 month momentum and no 9-month fallback. Map calendar month reference points to the nearest prior available trading session. Require a usable price at approximately t−13 months and t−1 month, plus the daily observations needed to calculate return volatility over the same measurement interval.

Fetch approximately **14 months** of daily history per update/bootstrap so the calculation has a buffer for month-end mapping, holidays, gaps, and provider revisions. Verify that the requested 14-month span has enough valid daily observations; elapsed calendar time alone is not sufficient.

The requested change from 10 to **13 months minimum trading history** is pending final Product Owner approval. Keep two explicit states in the data model/UI:

1. `universe_eligible`: passes security-type, exchange, price, liquidity, and approved minimum-history universe rules.
2. `momentum_eligible`: has sufficient valid 12–1 inputs and passes calculation validity checks.

Until the Product Owner approves D-01, do not silently advertise 13 months as an approved universe threshold. Regardless of D-01, a security without the actual valid standard 12–1 price window must not receive a 12–1 score.

## 5. Collection workflow

### Bootstrap / manual import

1. Check the source's current terms, download path, attribution, and local retention rules.
2. Record the user-selected source, source URL, file date/source-as-of date, local download time, applicable terms review date, and any required attribution.
3. Store the original downloaded file unchanged with a checksum; parse into staging tables rather than directly into the active dataset.
4. Validate schema, row counts, symbols, dates, duplicates, units, missingness, and basic value ranges.
5. Produce a review report for excluded/ambiguous securities and provider mismatches.
6. Promote only validated rows into normalized tables. Preserve import provenance.

### Incremental daily update

1. Load current approved universe state and its as-of date.
2. Determine the latest complete trading date per security and the approved source for each requested domain.
3. Request only missing prices with a small overlap for corrections, if automated requests are permitted. Respect provider limits and SEC Fair Access headers/rate rules.
4. Stage all responses; do not mutate the latest valid snapshot yet.
5. Validate data dates and basic OHLCV integrity. Identify missing sessions, splits/corporate actions, stale/partial provider coverage, and ticker/security mapping changes.
6. Fetch filing observations separately from daily prices; do not update share/float fields as if they were daily price data.
7. Commit validated new records idempotently and publish an update summary with succeeded, skipped, stale, and failed counts.
8. Calculate a new ranking snapshot only when required input completeness passes configured thresholds. Otherwise retain the last valid ranking and mark it stale/partial.

### Historical point-in-time reconstruction

For a decision timestamp `T`, only use records with `known_at <= T`. A filing fact's `period_end` can predate its `filed_at`; it is not available to a strategy before filing. Reconstruct market capitalisation from the price and share observation known at T. If no usable historical share/float observation exists, leave it missing or mark a clearly biased approximation; never substitute the present-day share count as if it had been known historically.

For universe membership, retain dated monthly snapshots as observations, not as proof that a security was continuously eligible between snapshots. Historical tests require point-in-time active listings, delisted securities, exchange/security type, and relevant eligibility inputs. If these cannot be reconstructed, clearly label survivorship/data limitations.

## 6. Validation and reconciliation

Minimum automated validation before promotion:

- unique `(security_id, trading_date, provider, price_basis)` keys;
- positive finite OHLC values, valid `low <= open/close <= high`, and non-negative volume where meaningful;
- expected trading sessions checked against a market calendar, with provider holidays/missing rows distinguished;
- adjusted/unadjusted split discontinuities flagged for review;
- source timezone/date normalization and duplicate-session handling;
- schema/column and date-range validation for imported CSVs;
- source timestamp, download timestamp, and coverage completeness;
- cross-source comparisons on a representative sample; mismatches are logged, not silently averaged;
- non-negative shares/float, plausible units, share-class scope, filing date, and point-in-time availability validation;
- public-float values stored as currency and never parsed into a shares field;
- market-cap calculations traceable to the exact price and shares/float observations used.

An individual missing value remains missing; do not convert it to zero. Securities with missing required fields should receive a specific eligibility or calculation exclusion reason.

## 7. Fallback behavior

- **Source unavailable or terms unclear:** do not automate it; use a user-provided file only if its acquisition/usage is permitted and recorded.
- **Fetch denied, blocked, or incomplete:** stop the batch, preserve the last valid data, show stale/failed state, and avoid challenge circumvention.
- **Primary selected source missing rows:** do not automatically fill with another website. A separately approved secondary source can be used only with field-level provider labels and a reconciliation policy.
- **Missing historical share/float data:** exclude the observation from unbiased historical weighting or report a separately labelled biased/sensitivity run if explicitly approved. Do not use current shares for past dates silently.
- **Missing delisted/security-master history:** scope the backtest to the available history and disclose survivorship limitations; do not represent it as point-in-time unbiased.
- **No compliant OHLCV source:** pause live ranking refresh and allow a documented manual data import. Any paid source requires separate approval.

## 8. Operational and audit requirements

For every import/update, record job ID, provider/source, request/file identifiers, terms/attribution metadata, as-of/known/download timestamps, parser and schema versions, row counts, validation issues, exclusions, and success/failure status. Store UTC internally and present market timestamps in US Eastern Time, as already required by General Settings.

Data retention and export behavior must follow each source's terms. The UI and exported tables should identify source/as-of and label approximations. Provider attribution required by a source must appear in the relevant data/about area and exports.

## 9. Implementation acceptance gates (future work)

Before enabling a source adapter:

1. Its current terms/access basis is recorded for automated retrieval, local storage, UI display, historical retention, and export separately.
2. A small representative download/import has been tested without bypassing restrictions.
3. Data mappings, price adjustments, date semantics, and missingness are documented.
4. Coverage and failure behavior are quantified for the chosen universe.
5. A second source or approved manual-import fallback is defined for critical data domains.

Before relying on the assembled dataset for a backtest:

1. At least two approved sources or a documented data-quality review establish OHLCV plausibility.
2. Filing observations are time-filtered on `known_at` and tested around filing/measurement dates.
3. Historical universe and delisted-security coverage are measured.
4. Shares outstanding, public float, float shares, and market-cap fields are validated as distinct concepts.
5. The remaining data gaps and any survivorship/look-ahead limitations are visible in run metadata and the dashboard.

# Final Validation Report

Date: 12 November 2026  
Project: US Momentum Terminal  
Data as-of: 11 November 2026

## Release Status

The project completed the audit, strategy correction, documentation and repository-consolidation
cycle. The current build starts, the five-page application renders, stock navigation works, both CSV
workflows produce 100 data rows, the browser console is clean, automated tests pass and the
production build succeeds.

This is an academically reviewable and runnable research terminal. It is not a production trading
system because the historical universe and fundamentals are not point-in-time.

The workspace contained no `.git` directory, so a Git checkpoint could not be created. Source and
test deletion was avoided; disposable files were moved to the macOS Trash for recovery.

## Final Fixture And Production Status

| Item | Result |
|---|---|
| Data service startup | PASS |
| Frontend development startup | PASS |
| Published stocks | 106 eligible common stocks |
| Portfolio holdings | 100 |
| Portfolio total weight | 100.000000% |
| Portfolio stock cap | 9.000000% maximum |
| Portfolio sector-group cap | 35.000000% maximum |
| Historical rebalances | 18 March/September events |
| Browser console errors | 0 |
| Production build | PASS |
| Sites package files | PASS |

## Final Automated Tests

### Python Unit Tests

Command:

```bash
npm run data:test
```

Result: **10 passed, 0 failed**

Coverage includes momentum score boundaries, Z-score capping, zero dispersion, 12-1 timing, daily
risk adjustment, adjusted-close-only construction, portfolio raw weights and caps, infeasibility,
NYSE holidays and early closes, semiannual execution and transaction costs.

### Frontend And Sites Tests

Command:

```bash
npm run test:frontend
```

Result: **5 passed, 0 failed**

Coverage includes portfolio CSV rank preservation and float-adjusted cap values, Sites asset
serving, route fallback, API-route protection and required build artifacts.

Combined command:

```bash
npm test
```

Result: **PASS**

### Live Integration Verification

Command, with the data service running:

```bash
npm run data:verify
```

Result: **PASS**

Key outputs:

- 109 scanned, 106 eligible.
- TSM excluded as an ADR.
- PARA excluded under the $5 common-stock price rule after the reused-symbol anomaly.
- WBA unavailable.
- One common as-of date: 11 November 2026.
- No null prices or non-finite scores.
- Momentum and volatility independently recomputed for AAPL, MSFT, NVDA, META and JPM.
- Raw portfolio formula maximum error: 0.000049 percentage points.
- Portfolio constraints all pass.
- Backtest costs, March/September months and next-session execution pass.
- AAPL current close matched Twelve Data exactly.
- Full evidence: `data-service/docs/verification.json`.

### Cached Data Audit

Command:

```bash
npm run data:audit
```

Result: **PASS with documented warnings**

- 111 cached series.
- 273,750 bars.
- 0 duplicate date rows.
- 0 unsorted series.
- 0 null adjusted/raw close rows.
- 0 weekend or exchange-holiday observations.
- 593 zero-volume rows, predominantly the excluded PARA collision and early thin SPMO trading.
- 21 extreme moves for review; 16 belong to PARA.
- Corporate-action row metadata remains unavailable in the old cache.
- Full evidence: `data-service/docs/data_quality.json`.

### Strategy Sensitivity

Command:

```bash
npm run data:sensitivity
```

Base Top 100 result:

| Metric | Result |
|---|---:|
| Window | 2 Apr 2018 to 11 Nov 2026 |
| Cumulative return | 367.2% |
| CAGR | 19.6% |
| Annualized volatility | 18.8% |
| Maximum drawdown | -34.7% |
| Sharpe, 0% risk-free | 1.05 |
| Annualized one-way turnover | 30.9% |
| Transaction costs | 0.9497% of initial $100 index |

The Top 20%, cost, slippage, monthly-rebalance and period results are recorded in
`data-service/docs/strategy_sensitivity.json` and the strategy report. These are exploratory
historical results, not a future-performance claim.

## Production Build

Command:

```bash
npm run build
```

Result: **PASS**

- 4,596 modules transformed.
- `frontend/dist/client/index.html`
- `frontend/dist/server/index.js`
- `frontend/dist/.openai/hosting.json`
- JavaScript bundle: approximately 326 kB; 97 kB gzip.
- CSS bundle: approximately 77 kB; 13 kB gzip.

No build warnings or errors were reported.

## Browser And Interaction Checks

Executed against the local development server and live data service:

- Overview loaded with 109 scanned, 106 eligible and 100 portfolio stocks.
- Screener Top 100 displayed exactly 100 rows.
- Stock Analysis navigation from MPC worked and returned to Screener.
- Portfolio showed 100 holdings and four passing constraints.
- Backtesting showed CAGR 19.6%, total return 367.2%, Sharpe 1.05 and drawdown -34.7%.
- Screener CSV downloaded as 101 lines including the header.
- Portfolio CSV downloaded as 101 lines including the header.
- Export filename and complete 100-row dataset were verified.
- Browser console warning/error query returned an empty list.
- Desktop layouts at 1280 × 720 were inspected.
- Mobile layouts at 390 × 844 were inspected.

The screenshots accepted in this run are in `docs/audit-screenshots/` and
`docs/PRODUCT_UI_AUDIT.md`.

## Issues Corrected

- Replaced the composite score with the specified piecewise cross-sectional score.
- Corrected risk adjustment to use daily return volatility.
- Restricted scoring to adjusted closes.
- Separated 10-month universe eligibility from full 12-1 momentum eligibility.
- Added exchange, security-type, currency, price, history and dollar-volume checks.
- Excluded the TSM ADR and the reused PARA symbol from the live common-stock universe.
- Corrected portfolio raw weights to float-adjusted cap × Momentum Score.
- Corrected the portfolio display and CSV to use true float-adjusted cap.
- Changed the sector cap from 34% to 35%.
- Added convergent capped proportional redistribution and infeasibility reporting.
- Changed backtest signals to March/September and execution to the next session.
- Excluded SPY and SPMO from backtest stock selection.
- Added 0.10% transaction costs and turnover reporting.
- Added explicit 0% Sharpe risk-free-rate metadata.
- Added NYSE holiday and early-close handling.
- Corrected Top 100 filtering, strategy-rank preservation and table export ranks.
- Corrected numeric portfolio market-cap sorting.
- Corrected the browser All-period return to include initial transaction cost.
- Corrected date shifting to be timezone-independent.
- Added route-aware document titles and accessible icon-only navigation labels.

## Files Relocated

- 79 approved historical application screenshots moved from root `screenshots/` to
  `docs/reference-screenshots/final-application/`.
- 10 earlier development and design QA reports moved to `docs/development-history/`.
- 28 source-brief, course-source and UI-reference files moved from the root agent package to
  `docs/source-brief/`.
- The root README and current handover documents now live in the locations listed below.

## Files Removed

The following disposable generated material was moved to the macOS Trash and is recoverable there:

- `.qa/`: 347 generated browser-test screenshots, scripts and debug outputs.
- `US_Momentum_Terminal_Agent_Package.zip`: 14.9 MB duplicate of the retained source-brief folder.
- Root and nested `.DS_Store` files.
- Python `__pycache__` directories and bytecode.

No source file, automated test, fixture, provider configuration, environment template, package
lockfile or project data file was deleted.

Ignored runtime/build material remains for a runnable local checkout:

- `.venv-datatest/`
- `frontend/node_modules/`
- `frontend/dist/`
- `data-service/cache/`

These are regenerable through the documented commands and are excluded by `.gitignore`.

## Final Documentation

- [README](../README.md)
- [Data Audit](DATA_AUDIT_REPORT.md)
- [Strategy Validation](STRATEGY_VALIDATION_REPORT.md)
- [Technical Documentation](PROJECT_TECHNICAL_DOCUMENTATION.md)
- [Product UI Audit](PRODUCT_UI_AUDIT.md)

## Final Folder Structure

```text
US_Momentum_Terminal/
├── README.md
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── data-service/
│   ├── app/
│   ├── tests/
│   ├── docs/
│   ├── cache/                  # ignored runtime data
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── tests/
│   ├── worker/
│   ├── scripts/
│   ├── package.json
│   └── package-lock.json
└── docs/
    ├── DATA_AUDIT_REPORT.md
    ├── STRATEGY_VALIDATION_REPORT.md
    ├── PROJECT_TECHNICAL_DOCUMENTATION.md
    ├── FINAL_VALIDATION_REPORT.md
    ├── PRODUCT_UI_AUDIT.md
    ├── audit-screenshots/
    ├── reference-screenshots/
    ├── source-brief/
    └── development-history/
```

## Important Issues Remaining

1. The live candidate universe is a curated 109-symbol list, not a complete daily scan of all US
   common stocks.
2. Historical constituents, stable security identifiers and delisting returns are unavailable.
3. Historical float-adjusted market caps are unavailable, so the backtest uses equal weights.
4. Market cap and float shares are current rather than point-in-time.
5. The primary provider is unofficial Yahoo Finance.
6. Existing cached batch bars lack per-row dividend and split fields.
7. Full-universe cross-provider validation needs paid backup credentials.
8. The Sharpe Ratio uses a documented 0% risk-free rate.
9. The mobile UI hides the full update bar.
10. WBA currently has no provider data.
11. No live execution, taxes, market-impact, capacity or paper-trading evidence exists.

The unresolved items above are limitations, not failed tests. They prevent claims of complete
point-in-time market accuracy or guaranteed strategy reliability.

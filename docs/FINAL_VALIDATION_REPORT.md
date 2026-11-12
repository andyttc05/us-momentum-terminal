# Final Validation Report

Validation date: 12 November 2026
Market data as of: 11 November 2026

## Release Status

The repository was reviewed, cleaned, and updated for academic review. The public documentation,
website information, quantitative method, and test evidence now describe the same current
implementation.

The application remains an educational research terminal. The historical test is not a
point-in-time market reconstruction and does not establish future investment performance.

## Automated Verification

| Check | Command | Result |
| --- | --- | --- |
| Python unit tests | `npm run data:test` | 13 passed |
| Frontend unit tests | `npm --prefix frontend run test:unit` | 22 passed |
| Sites worker tests | `npm run test:sites` | 4 passed |
| Production build | `npm run build` | Passed |
| Live API verification | `npm run data:verify` | Passed |

The frontend unit command includes the Sites worker tests in its standard glob, so the combined
frontend result is 22 unique tests; the separate Sites command is shown for deployment verification.

## Live API Verification

The local FastAPI service returned a current publication with:

- 200 requested symbols and 198 eligible common stocks.
- One common market-data date: 11 November 2026.
- No null prices or NaN scores.
- A strictly ordered rank sequence from 1 through 198.
- Independent momentum recomputation within tolerance for AAPL, MSFT, NVDA, META and JPM.
- 100 portfolio holdings with 100.000000% total final weight.
- Maximum individual weight of 8.999994%.
- Maximum constraint-sector-group weight of 35.000000%.
- All portfolio constraints passing.
- 18 March/September backtest rebalances with execution after each signal.
- 0.10% transaction costs applied and a documented 0% Sharpe risk-free rate.
- AAPL matching the Twelve Data public demo close at `$355.63` on 11 November 2026.

Generated evidence is stored in `data-service/docs/verification.json`.

## Base Backtest Snapshot

| Metric | Result |
| --- | ---: |
| Window | 2 Apr 2018 to 11 Nov 2026 |
| Cumulative return | 367.2% |
| CAGR | 19.6% |
| Annualized volatility | 18.8% |
| Maximum drawdown | −34.7% |
| Sharpe Ratio, 0% risk-free | 1.05 |
| Annualized one-way turnover | 30.9% |

These values are an exploratory historical result. The 108-stock historical core, equal weighting,
current-universe knowledge, and missing point-in-time float data limit interpretation.

## Browser and Responsive Review

The updated application was opened against the local FastAPI service and reviewed at:

- 1440 × 900 desktop.
- 768 × 1024 tablet.
- 390 × 844 phone.

At every size:

- The established dashboard layout remains intact.
- The new “About” disclosure is reachable by keyboard and pointer.
- The information panel remains within the viewport.
- The panel presents project purpose, data source, methodology, backtest assumptions, limitations,
  and links to the README and technical documentation.
- Existing navigation, cards, charts, tables, sector allocation, and status surfaces remain present.

No substitute market values were introduced.

## Repository Cleanup

The public tree now contains:

```text
.
├── .github/workflows/
├── data-service/
├── docs/
│   ├── screenshots/
│   ├── PROJECT_OVERVIEW.md
│   ├── TECHNICAL_DOCUMENTATION.md
│   ├── DATA_AUDIT_REPORT.md
│   ├── STRATEGY_VALIDATION_REPORT.md
│   └── FINAL_VALIDATION_REPORT.md
├── frontend/
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── THIRD_PARTY_NOTICES.md
├── package.json
└── package-lock.json
```

The complete internal source-brief package, course-originated files, third-party reference images,
obsolete task reports, old design-history documents, and unused screenshot archives were preserved
in a separate local archive outside the public repository.

Useful application screenshots were retained in `docs/screenshots/` with descriptive names.
The MIT license, third-party notices, environment template, lockfiles, source code, tests, seed data,
and runtime assets remain in place.

## Documentation Consistency

- `README.md` now provides the project overview, live links, architecture, data process, exact
  methodology, portfolio and backtest rules, installation, limitations, and documentation index.
- `docs/PROJECT_OVERVIEW.md` provides a concise academic explanation.
- `docs/TECHNICAL_DOCUMENTATION.md` documents the actual React/FastAPI implementation, Mermaid
  architecture, cache, endpoints, universe, formulas, current portfolio rule, backtest, deployment,
  and tests.
- `docs/DATA_AUDIT_REPORT.md` records provider coverage, integrity checks and data limitations.
- `docs/STRATEGY_VALIDATION_REPORT.md` records calculation and backtest validation.
- Provider and component READMEs match the current implementation.

## Remaining Limitations

- Curated rather than complete US universe.
- Current rather than point-in-time market capitalization and float shares.
- No complete historical constituents or delisting-return model.
- Equal-weight historical proxy.
- Unofficial primary provider.
- Zero risk-free-rate Sharpe assumption.
- No live execution, taxes, market impact, capacity, or paper-trading evidence.
- No automated pixel-level visual-regression suite.

These limitations are documented as research constraints, not hidden as failed test results.

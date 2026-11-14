# US Momentum Terminal: Backtesting Quantitative Audit

Audit date: 14 November 2026

Audited branch: `feat/backtesting-completion`

Publication audited: `2026-11-14-cashflow-accounts-v14`

Cash-flow follow-up evidence: [CASHFLOW_INTEGRATION_AUDIT.md](CASHFLOW_INTEGRATION_AUDIT.md).

## A. Executive Summary

**Final status: PASS WITH LIMITATIONS.**

The corrected backtest engine reconciles the published NAV, daily returns, cumulative return, CAGR,
volatility, Sharpe, Sortino, maximum drawdown, annual returns, benchmark-relative metrics and account
cashflows. The four rebalance schedules, next-session execution, transaction costs, dividend modes,
portfolio constraints and cashflow floor are covered by independent synthetic fixtures in addition
to the repository test suite.

The audit found and fixed two material integrity defects:

1. **High: the first calendar period omitted the initial entry cost.** Annual and monthly period
   returns rebased the opening period on the first post-cost NAV. They now use the 100 starting
   capital when the window begins at the backtest origin.
2. **High: historical outstanding-share sizing was labelled as production float sizing.** The
   historical input is point-in-time shares outstanding, not historical float shares. It now reports
   `score-size-proxy`, `live_weighting_tested: false`, and separates production-float, outstanding-
   share-proxy and equal-weight event counts. The published limitation is explicit.

Two reliability gaps were also corrected:

- stale historical price tails are refreshed before simulation, and tails beyond five sessions make
  the backtest unavailable instead of being silently forward-filled;
- Sortino, beta, correlation, tracking error and information ratio, a monthly analysis table, and the
  required Performance Summary and Benchmark Comparison workbook sheets were added.

Remaining limitations are principally data limitations: the historical universe is a curated set of
current survivors, historical sector classifications are not point-in-time, historical float shares
are unavailable, and delisting returns are not modelled. These prevent a claim of survivorship-bias-
free or production-float-rule validation.

## B. Audit Inventory

| Input | Transformation | Formula or rule | Calculation location | Published output | Consumers |
| --- | --- | --- | --- | --- | --- |
| Daily OHLCV, adjusted close, dividends, splits | Sort, de-duplicate, reject non-positive rows | Adjusted-close returns; split-normalized cash-dividend path | `data-service/app/models.py`, `momentum.py`, `backtest.py` | Momentum, NAV, benchmark and dividend series | Backtesting charts, tables, exports |
| Point-in-time shares outstanding and split-normalized close | Latest share observation at or before signal date; reject observations older than 750 days | `market cap = shares × split-normalized close` | `data-service/app/size_history.py` | Historical size proxy | Historical portfolio weights |
| 12–1 adjusted closes | 252-session lookback, 21-session skip | `P(t-21) / P(t-252) - 1` | `momentum.py` | Momentum, risk-adjusted momentum | Screener, selection |
| Momentum return and volatility | Sample standard deviation of 231 returns | Risk-adjusted momentum, clipped population Z-score, asymmetric score | `momentum.py` | Score and rank | Screener, Portfolio, Backtesting |
| Score and size input | Select by score; size selected names; apply caps | `score × (size / median size)^0.5`, 9% stock, 35% sector-group | `portfolio.py` | Current production book; historical proxy book | Portfolio, historical holdings |
| Daily strategy NAV | Rebalance at next close; mark to market; deduct traded-notional costs | Daily wealth index starting at 100 | `backtest.py` | Strategy, SPY, SPMO series | Charts, metrics, exports |
| Daily returns and peaks | Sample moments and running peak | CAGR, volatility, Sharpe, Sortino, drawdown | `backtest.py`, `frontend/src/utils/backtestMetrics.js` | Risk metrics | Performance and risk cards, workbook |
| Selected daily window | Slice, rebase subranges, optionally deflate by CPI | External cashflows applied after investment return | `frontend/src/utils/backtestReport.js` | Account timeline and cashflow ledger | KPIs, tooltips, report, exports |
| Dated investor cashflows | Solve dated NPV | XIRR; linked strategy return for TWR | `backtestReport.js` | Money- and time-weighted returns | Performance Summary |

## C. Data Quality

Evidence: `data-service/docs/data_quality.json`, generated 14 November 2026.

| Check | Result |
| --- | --- |
| Cached series inspected | 311 |
| Cached rows inspected | 741,458 |
| Coverage range | 2016-11-14 through 2026-11-13 |
| Duplicate dates | 0 |
| Unsorted series | 0 |
| Negative or zero prices | 0 |
| Invalid OHLC rows | 0 |
| Weekend or unscheduled exchange dates | 0 |
| Null price rows | 1 (`PARA`) |
| Maximum missing-session gap | 1 session |
| Maximum missing-session ratio | 0.069% |
| Invalid corporate-action rows | 0 |
| Recorded dividend events | 8,621 |
| Recorded split events | 67 |
| Extreme adjusted moves of at least 35% | 92, flagged for review rather than removed |
| Stale tails in audited universe | 0 |

The single null-price row and missing session belong to `PARA`. Its current close is below the $5
inclusion threshold and its provider series is marked unadjusted, so it is excluded from the live
momentum population. The 645% non-adjusted discontinuity is therefore not admitted to the adjusted-
return calculation. The exclusion is visible in the publication rather than repaired with synthetic
data.

Zero-volume observations (665 rows) are not treated as price errors. They can occur in thin trading,
halted sessions or provider behavior. No negative volume row was found.

### Corporate actions and dividend conventions

- Total return uses provider adjusted close.
- Dividend-exclusive return uses split-normalized close and records per-share dividends as cash.
- Split actions are not applied a second time to an already split-normalized close.
- Synthetic split, dividend, reinvestment and cash-retention fixtures pass.
- Dividend-exclusive mode is blocked when required price series or action coverage is incomplete.
- The historical sizing proxy is not called float-adjusted.

### Provider evidence

The live probe tested 20 symbols on 14 November 2026:

| Provider | Availability | Result |
| --- | --- | --- |
| Yahoo Finance | Connected | 20/20 symbols, latest date 2026-11-13 |
| Twelve Data | Demo access | 2/20 symbols |
| Financial Modeling Prep | HTTP reachable | API key required; 0 authenticated samples |
| Stooq | HTTP reachable | 0/5; no usable adjusted series |

AAPL cross-provider closes matched to 0.000% between Yahoo and Twelve Data. QQQ is not in the
published stock universe. Provider evidence is in
`data-service/docs/provider_probe.json`.

### Survivorship and look-ahead assessment

- The historical scan uses 108 curated current core names, not a point-in-time security master.
- Delisted companies and historical index membership are absent.
- The point-in-time sector-cap calculation uses current curated sector classifications. That is a
  residual look-ahead limitation, although scoring itself uses only trailing adjusted closes and
  volume.
- Historical size inputs use only share counts and prices dated on or before the signal date.
- Current float shares are not substituted into past events.
- Signal formation occurs at the final scheduled trading session; execution occurs at the next
  available close.
- The bias cannot be eliminated with the configured providers, so survivorship-free and fully
  point-in-time claims are unsupported.

## D. Formula Verification

Numeric outputs were recomputed from the raw returned series using independent NumPy, pandas,
JavaScript and spreadsheet calculations. Published monetary fields are rounded to four decimals,
percent fields to one or two decimals, and weights to six decimals unless otherwise stated.

| Calculation | Formula | Code location | Verification | Result |
| --- | --- | --- | --- | --- |
| 12–1 momentum | `P(t−21)/P(t−252)−1` | `momentum.py` | Independent array slice and hand fixture | PASS |
| Volatility | Sample σ of 231 daily returns × `sqrt(252)` | `momentum.py`, `backtest.py`, `backtestMetrics.js` | Recalculated from NAV and benchmark bars | PASS |
| Risk-adjusted momentum | 12–1 return / daily σ | `momentum.py` | Hand fixture | PASS |
| Cross-sectional Z-score | Population σ, clipped to ±3 | `momentum.py` | Independently constructed cross-section | PASS |
| Momentum Score | `1+Z` or `1/(1−Z)` | `momentum.py` | Boundary and ranking fixtures | PASS |
| Current raw weight | Score × relative sqrt float cap | `portfolio.py` | Independent raw formula | PASS |
| Historical sized weight | Score × relative sqrt outstanding-share cap | `backtest.py`, `size_history.py` | PIT lookup and hand formula | PASS AS PROXY |
| Historical float-cap validation | Requires historical float shares | N/A | No provider supplies historical float shares | BLOCKED |
| Stock/sector caps | 9% stock, 35% canonical sector group | `portfolio.py` | Property and bound fixtures | PASS |
| Total allocation | Σ final weights = 100% | `portfolio.py` | Six-decimal tolerance `1e-5` | PASS |
| Monthly schedule | Final session of each month → next session | `backtest.py` | Calendar fixtures | PASS |
| Quarterly schedule | Mar/Jun/Sep/Dec | `backtest.py` | Calendar and execution fixtures | PASS |
| Semiannual schedule | Mar/Sep | `backtest.py` | Holiday and API fixtures | PASS |
| Annual schedule | Sep | `backtest.py` | Calendar and API fixtures | PASS |
| Transaction cost | Traded notional × one additive cost/slippage rate | `backtest.py` | 0, 10, 50 bps fixtures | PASS |
| One-way turnover | `gross traded notional / (2 × NAV)` | `backtest.py` | Synthetic and sensitivity runs | PASS |
| Cumulative return | `ending NAV / 100 − 1` | `backtest.py`, `backtestMetrics.js` | Independent NAV recomputation | PASS |
| CAGR | `(ending/100)^(365/days) − 1` | Both engines | Leap and partial-period fixtures | PASS |
| Sharpe | `mean daily excess / sample σ × sqrt(252)` | Both engines | Hand fixture; documented 0% risk-free rate | PASS |
| Sortino | `mean excess / downside deviation × sqrt(252)` | Both engines | Hand downside-deviation fixture | PASS |
| Beta | `Cov(strategy, benchmark) / Var(benchmark)` | Both engines | Aligned daily-return fixture | PASS |
| Correlation | Pearson correlation of daily returns | Both engines | Aligned daily-return fixture | PASS |
| Tracking error | Sample σ of active daily returns × `sqrt(252)` | Both engines | Aligned daily-return fixture | PASS |
| Information ratio | Mean active return / active σ × `sqrt(252)` | Both engines | Aligned daily-return fixture | PASS |
| Maximum drawdown | Minimum of `NAV / running peak − 1` | Both engines | Crash/recovery fixture | PASS |
| Annual return | Calendar year-end / prior year-end | Both engines | Independent NAV recomputation | PASS |
| Opening period return | Year/month-end / 100 starting capital | Both engines | Entry-cost regression fixture | PASS |
| TWR | Linked strategy NAV return | `backtestReport.js` | Contribution/no-contribution comparison | PASS |
| XIRR | Root of dated NPV | `backtestReport.js` | Hand XIRR example | PASS |
| Net P&L | Ending value + actual outflows − initial capital − inflows | `backtestReport.js` | Cashflow identities | PASS |
| Outflow floor | `min(requested, available)`; ending ≥ 0 | `backtestReport.js` | Depletion and insufficient-funds fixtures | PASS |

### Published result independently reconciled

Top 100, semiannual, full published window:

| Metric | Published | Recalculated | Tolerance |
| --- | ---: | ---: | --- |
| Total return | 406.1% | 406.1% | ±0.15 pp |
| CAGR | 20.7% | 20.7% | ±0.15 pp |
| Annualized volatility | 20.2% | 20.2% | ±0.15 pp |
| Sharpe, 0% risk-free | 1.03 | 1.03 | ±0.02 |
| Sortino, 0% risk-free | 1.48 | 1.48 | ±0.02 |
| Maximum drawdown | −32.1% | −32.1% | ±0.15 pp |
| SPY beta | 1.028 | 1.028 | ±0.003 |
| SPY correlation | 0.963 | 0.963 | ±0.003 |
| SPY tracking error | 5.5% | 5.5% | ±0.1 pp |
| SPY information ratio | 0.94 | 0.94 | ±0.02 |

The published NAV, drawdown, annual returns, benchmarks and export values reconcile to their source
series. A complete-window frontend result uses backend metrics; a narrowed chart window is derived
with the same 365-day CAGR, 252-session risk annualization and sample-standard-deviation convention.

## E. Functional Verification

The actual local Backtesting page was exercised through the live FastAPI data service:

- 100- and 20-holding datasets loaded without cross-dataset row mixing;
- all four chart ranges and log-scale controls rendered;
- annual and monthly tables displayed the selected window;
- the Performance Summary and Risk & Benchmark Analysis rendered;
- dependency-free navigation and loading shells remained mounted;
- historical rebalance and holdings selectors, filters and pagination were present;
- an outflow of `$20,000` per month against a `$10,000` opening balance was run end to end;
- the account reached exactly `$0`; `$10,577` was actually withdrawn and `$2,049,423` was recorded
  unpaid rather than borrowing or creating value after depletion;
- TWR remained `+440.56%`, independent of the external withdrawals;
- the XIRR changed to `+102.60%` because investor cashflow timing changed;
- CSV and Excel downloads were generated and parsed after download;
- the workbook contained Daily Performance, Drawdown, Monthly Returns, Rebalancing History, Cash
  Flows, Performance Summary, Benchmark Comparison and Backtest Settings;
- the CSV contained 2,170 rows including its header, matching all 2,169 daily observations;
- phone layout at 390 px had no horizontal overflow and retained the monthly/risk cards;
- the browser console contained no application errors.

The financial engine has no broker integration and does not place trades. This audit verifies
calculation and reporting behavior, not execution against live orders.

## F. Defects Fixed

### Critical

None remaining.

### High

1. **Initial-period return baseline**
   - Root cause: period returns used the first NAV, which had already paid the entry cost.
   - Correction: opening annual/monthly/quarterly periods now use the 100 starting capital.
   - Files: `data-service/app/backtest.py`, `frontend/src/utils/backtestReport.js`.
   - Regression: Python `test_first_calendar_year_includes_the_initial_entry_cost`; frontend
     `the opening period includes the initial entry transaction cost`.

2. **Mislabeled historical float sizing**
   - Root cause: point-in-time shares outstanding were used by a variable and label named as float
     market cap, and the publication claimed `live_weighting_tested: true`.
   - Correction: explicit `score-size-proxy` label, separate event counts, false production-float
     validation flag and a published limitation.
   - Files: `data-service/app/backtest.py`, `size_history.py`, `snapshot.py`, frontend evolution
     labels and current static publication.
   - Regression: `test_outstanding_share_history_is_never_labelled_as_float_sizing`.

### Medium

3. **Stale cached tails**
   - Root cause: on-demand backtests preferred cached bars without comparing tails to the freshest
     cached history.
   - Correction: refresh all missing/materially stale tails; fail rather than silently forward-fill
     a tail longer than five sessions; publish `dataQuality`.
   - Regression: `test_materially_stale_price_tail_blocks_the_backtest`.

4. **Incomplete risk and export surface**
   - Added Sortino, beta, correlation, tracking error and information ratio.
   - Added Monthly Performance, Performance Summary and Benchmark Comparison workbook sheets.
   - Added shared frontend fixtures for annualization, aligned returns and downside deviation.

5. **Incomplete data-quality evidence**
   - Added negative/zero price, OHLC consistency, missing-session ratio, longest-gap, stale-tail,
     invalid-action, dividend/split-event and volume diagnostics.

## G. Known Limitations

- Yahoo Finance is unofficial and provides no service-level guarantee.
- Historical membership is based on a curated current-survivor core, not a point-in-time security
  master.
- Delisted securities and delisting returns are not modelled.
- Historical float shares are unavailable. Historical sizing uses point-in-time outstanding shares
  and cannot validate the production float-cap formula.
- Historical sector membership is not point-in-time.
- Interest, taxes, market impact, borrow costs and capacity limits are not modelled.
- The designated execution price is the next available adjusted close. Real closing-auction fills,
  partial fills and intraday slippage are not simulated.
- A provider price anomaly can affect a report until it is explicitly excluded or corrected; extreme
  moves are therefore flagged for review rather than automatically deleted.
- Backtest results are sensitive to provider adjusted-close history. They must not be compared
  numerically with Portfolio Visualizer unless portfolio, membership, dates, fees, rebalance,
  benchmark, cashflow and dividend conventions are identical.
- The branch is committed and pushed, but it is not merged or deployed to `main` without authorization.

## H. Test Evidence

Canonical commands and results at the end of this audit:

```text
npm run data:test
138 Python tests passed

npm run test:frontend
286 frontend tests passed

npm run data:audit
exit 0; 311 series and 741,458 rows inspected

npm run data:probe
exit 0; provider report written

npm run data:validate-static
Static data valid: 198 stocks, as-of 2026-11-13

npm run data:verify
PASSED

npm run data:sensitivity
exit 0; exploratory scenario report written

npm run data:weighting
exit 0; PIT float coverage 0%, historical proxy available

npm run test:sites
4 Sites worker tests passed

npm run build
PASS; Vite transformed 4,639 modules and prepared the Sites artifact
```

The production build reports the main application entry at 510.00 kB minified (151.10 kB gzip);
Vite emits a non-failing chunk-size advisory. The lazy spreadsheet chunk is 429.53 kB minified
(141.92 kB gzip). The worktree contains no private keys. Local cache and build directories are
ignored.

## I. Final Status

**PASS WITH LIMITATIONS** for the audited calculations, cashflow accounting, published metrics,
exports and application behavior. The configured data cannot support a claim of point-in-time float
validation or survivorship-bias-free historical membership.

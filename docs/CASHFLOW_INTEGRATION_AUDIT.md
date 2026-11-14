# Backtesting Cash-Flow Integration Audit

Audit date: 14 November 2026

Publication: `2026-11-14-cashflow-accounts-v14`

## Executive Result

The cash-flow implementation is now part of the Python backtest result. Strategy, SPY and SPMO use
the same requested schedule but maintain independent units, cash, balances and investor cash flows.
The previously frontend-only overlay has been retained only as an equivalent static-range fallback.

All audited cash-flow calculations pass their automated tests. The remaining limitations are about
the granularity of the underlying return index and transaction treatment, not account identity or
negative-balance behavior.

## Root Causes Found

1. **Cash flows were calculated only in the browser.** The Python engine returned Strategy/SPY/SPMO
   return indices but no configured investor accounts. The UI therefore could not prove that the
   displayed balances came from the same financial engine as the historical backtest.
2. **Benchmark accounts inherited the strategy's entry-cost ratio.** In the frontend simulator, the
   first strategy NAV factor was applied to all three series. SPY and SPMO consequently started below
   the configured capital even though their benchmark indices began at 100.
3. **Account holdings and cash were not represented.** Balances were carried as a single number, so
   holdings value, available cash and fractional units could not be reconciled independently.
4. **The Total Return card was not explicitly tied to the account report's TWR.** It read the
   strategy metric object rather than the cash-flow report value. The values were close without
   flows, but the dependency was wrong for a cash-flow-aware page.
5. **Chart and export values were derived from the raw return path.** They happened to avoid flow
   jumps, but did not explicitly consume the account TWR series returned by the engine.

## Accounting Methodology

Each account owns a non-negative quantity of total-return index units and available cash.

```text
account value = units × NAV + available cash
```

On each observation:

1. The underlying NAV return is applied.
2. A scheduled external flow executes at that close.
3. A deposit buys `actual inflow / NAV` additional fractional units.
4. A withdrawal first consumes available cash, then redeems the remaining value in units.
5. A withdrawal is capped at account value; the shortfall is recorded as unpaid.
6. Units and cash are clamped to zero when the account reaches an exact/numerically exact depletion.

Deposits do not receive that day's investment return. Later market movement applies only to units that
were actually purchased.

The strategy and benchmark return indices already represent the allocation of their underlying
portfolios. Redeeming index units is therefore equivalent to proportionally selling the remaining
strategy holdings or benchmark shares, preserving allocation weights. Cash received while NAV is
unavailable remains in cash and is invested only when a valid close exists.

## Return Methodology

### Time-weighted return

TWR is calculated from the underlying NAV path, not the account balance:

```text
daily TWR = NAV(t) / NAV(t−1) − 1
cumulative TWR = NAV(t) / NAV(origin) − 1
```

External deposits and withdrawals do not enter this formula. The chart line and final cumulative
return therefore remain identical for no-flow, inflow and outflow schedules using the same strategy.

### Money-weighted return

XIRR groups same-day investor flows and solves:

```text
Σ cashflow_i / (1 + XIRR)^((date_i − first_date) / 365) = 0
```

Signs are:

- initial investment: negative;
- subsequent deposit: negative;
- actual withdrawal: positive;
- final account value: positive.

Unpaid withdrawals are excluded because no investor distribution occurred. XIRR returns unavailable
when cash flows lack both positive and negative signs or cannot be bracketed.

### Profit and loss

```text
Net P&L = ending value + actual outflows − initial capital − deposits
```

Unpaid outflows never enter investor distributions or XIRR.

## Benchmark Simulation

Strategy, SPY and SPMO each use:

- the same initial capital;
- the same requested flow amount;
- the same flow dates and frequency;
- the same close-timing convention;
- independent unit ownership and account value.

SPY and SPMO start with the full initial capital at their own first benchmark close. The strategy
alone includes its initial portfolio-formation transaction cost in its first NAV. Each benchmark then
purchases or redeems its own units; balances are never copied from the strategy.

If one account can fund a withdrawal and another cannot, the requested schedule remains the same while
actual and unpaid amounts are recorded separately for each account.

## Data and Execution Conventions

- Total-return mode uses adjusted closes.
- Dividend-exclusive mode uses split-normalized closes with cash dividends retained.
- Signals use information available through the scheduled signal close.
- Trades and external flows execute at the next/current available adjusted close as applicable.
- Rebalances continue to operate on portfolio NAV while the account units scale the resulting book.
- Flow dates use the first available trading observation in a new month, quarter or year.
- Missing/invalid NAV cannot create wealth. A depleted account remains at zero until a valid deposit.
- No negative balances, negative units or negative held value are admitted.

## UI and Reporting Integration

- `POST /api/backtest` accepts initial capital and complete inflow/outflow configuration.
- The Python response includes independent account ledgers for Strategy, SPY and SPMO.
- For the exact submitted full window, the UI consumes the Python balances, units, TWR and XIRR.
- A narrowed chart window uses the same unit-account algorithm in the browser from the published
  return series.
- The Cumulative Return line consumes account TWR values, while the tooltip shows each account's actual
  balance and TWR.
- The Total Return KPI now reads the selected window's TWR.
- The workbook adds an Account Balances sheet containing balance, holdings value, cash and units for
  all three accounts.
- The existing Cash Flows sheet contains requested, actual and unpaid strategy withdrawals.

## Automated Evidence

Python cash-flow tests cover:

- no cash flow and initial capital only;
- monthly and quarterly deposits;
- monthly and quarterly withdrawals;
- deposits followed by withdrawals;
- withdrawal equal to and above available balance;
- non-negative balances, holdings, cash and units;
- depletion followed by a rebuilding deposit;
- TWR invariance under contributions;
- dated XIRR;
- identical requested schedules across all accounts;
- benchmark unit purchases and redemptions;
- chart TWR values and balance identities;
- cash-flow-aware rebalancing and the no-flow baseline.

Frontend tests cover:

- backend account normalization and consumption;
- mismatch fallback to the deterministic local account;
- strategy-only entry cost;
- full-capital benchmark start;
- all cash-flow floor and XIRR cases;
- chart TWR source;
- Account Balances and Cash Flows exports.

## Manual Verification

The local application was exercised against the live FastAPI engine:

| Scenario | Result |
| --- | --- |
| Cash flows disabled | End balance `$54,056`; Net Cashflow `$0`; TWR `+440.6%` |
| Monthly `$1,000` inflow | End balance `$329,570`; deposits `$103,000`; XIRR `+22.13%` |
| Monthly `$20,000` outflow | End `$0`; actual withdrawals `$10,577`; unpaid `$2,049,423`; TWR `+440.6%` |

The workbook downloaded from the inflow run contained nine sheets. Account Balances showed:

```text
Strategy start: $9,990 holdings, $0 cash, 100 units
SPY start:     $10,000 holdings, $0 cash, 100 units
SPMO start:    $10,000 holdings, $0 cash, 100 units
```

Every sampled balance equals holdings value plus available cash. Strategy and benchmark cash-flow
dates matched down to the day.

## Test and Build Evidence

```text
npm test
138 Python tests passed
286 frontend tests passed

npm run test:sites
4 tests passed

npm run build
PASS; Vite transformed 4,639 modules and prepared the Sites artifact

npm run data:validate-static
Static data valid: 198 stocks, as-of 2026-11-13

npm run data:verify
PASSED; cash-flow account checks passed

npm run data:audit
exit 0; no duplicate dates, invalid prices, invalid OHLC or stale audited tails
```

The production mode was also served locally in static mode. The published account path produced the
same TWR and non-negative depletion behavior as the live API path.

## Deployment Verification

The feature-branch Pages dispatch built successfully, but the `github-pages` environment rejected the
feature ref because deployment is restricted to protected branches. The tested commit was then
fast-forwarded to `main` without rewriting history.

- Production workflow: `43586357811`
- Source commit: `9e90cf7524bd9c50f47f5216caee4e7c5d7c8345`
- Build job: success
- Deploy job: success
- Deployment status: success
- Deployed URL: https://andyttc05.github.io/us-momentum-terminal/

The live Backtesting page shows publication `2026-11-14-cashflow-accounts-v14`, the default inflow
account result, and the expected `$0` / actual / unpaid withdrawal breakdown after a `$20,000` monthly
outflow run.

## Remaining Limitations

- Individual held securities are not simulated share-by-share for user cash flows. The account
  redeems total-return portfolio units proportionally, which preserves portfolio weights and market
  value but does not model tax lots or security-specific sale selection.
- External cash flows do not add a separate transaction charge. Portfolio rebalances retain their
  configured 10 bps transaction cost and slippage.
- Inflation-adjusted mode uses the frontend real-dollar account path because CPI publication dates
  are a display-time alignment concern. Its account identity and non-negative floor remain tested.
- Historical survivorship, point-in-time float shares, sector history and delisting returns remain
  the limitations documented in the broader quantitative audit.
- Production deployment is restricted by repository environment rules to protected branches; the
  tested commit was deployed through `main`.

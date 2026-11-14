# Backtesting Cash-Flow Integration Audit

Audit date: 14 November 2026

Publication: `2026-11-14-cashflow-accounts-v14`

## Executive Result

The cash-flow implementation is now part of the Python backtest result. Strategy, SPY and SPMO use
the same requested schedule but maintain independent units, cash, balances and investor cash flows.
The previously frontend-only overlay has been retained only as an equivalent static-range fallback.

A second pass corrected the *reporting* layer on top of that engine. One `buildBacktestAnalysis()`
object now feeds every KPI card, chart, table and export, the performance chart gained an explicit
cashflow-inclusive dollar view, and risk statistics are separated into investment (unitized NAV) and
account-balance measurements.

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

The reporting pass found four further defects:

6. **The performance chart had no account-value view.** It plotted a percentage series only, so the
   configured deposits and withdrawals changed the End Balance card but were invisible in the chart.
   The only dollar figures were tooltip text.
7. **A chart range filter re-ran the simulation.** Selecting `1Y` built a new window and restarted the
   account with full opening capital one year ago, so the chart showed a different investor than the
   KPI cards above it.
8. **Maximum drawdown and the drawdown chart used one basis only.** The unitized-NAV (investment)
   drawdown was correct, but there was no account-balance drawdown, and nothing stated which basis a
   displayed number used.
9. **The headline return card answered the wrong question when cashflows were enabled.** It showed
   the flow-neutral TWR while the rest of the page reported the investor's account, so a saver making
   monthly deposits could not see their own money-weighted result without opening a secondary table.

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

## Single Analysis Path

`frontend/src/utils/backtestReport.js` exposes one builder, `buildBacktestAnalysis(window, config,
backendAccounts)`. It simulates Strategy, SPY and SPMO once and returns:

- the three account contracts (balances, holdings, cash, units, TWR, drawdown and events);
- the investor totals, net P&L, TWR and XIRR;
- the investment drawdown series and the account-balance drawdown series;
- the annual, quarterly and monthly flow-neutral return rows.

Every consumer reads that object:

| Consumer | Reads |
| --- | --- |
| KPI cards | `finalValue`, `initialCapital`, `moneyWeightedReturnPct`, `timeWeightedReturnPct` |
| Performance Summary and Risk tiles | the same fields plus `metrics.benchmarkRelative` |
| Performance chart | `accounts[id].values` or `accounts[id].returns`, sliced by range |
| Drawdown chart and badge | `accountDrawdown` / the unitized NAV drawdown |
| Annual and monthly tables | `annualRows`, `monthlyRows` |
| CSV and workbook | the same object rebuilt from the same window and configuration |

`calculateBacktestReport()` is now an alias returning the same object, so legacy callers cannot
silently compute a second answer.

The Python service stays authoritative whenever it publishes accounts for exactly the submitted
configuration. The browser engine is a byte-compatible fallback for cases the service cannot cover
(the inflation-adjusted view) and is pinned to the Python numbers by a mirrored test table.

## Drawdown and Risk Measurement

Two measurements are published and labelled separately.

### Investment drawdown (standard risk metric)

```text
drawdown(t) = NAV(t) / running peak of NAV − 1
```

Use for Maximum Drawdown, the drawdown chart's default basis, volatility, Sharpe, Sortino, beta,
correlation, tracking error and the information ratio. Because it is computed on the unitized
total-return NAV, a deposit cannot mask a loss and a withdrawal cannot manufacture one.

### Account-balance drawdown (cashflow view)

```text
drawdown(t) = balance(t) / running peak of balance − 1
```

Use for the `Account` basis of the same chart and for the "Account Max Drawdown" tile. An executed
withdrawal appears here as a fall in the balance, which is the intended meaning: it tracks the money
the investor actually owns, not market losses.

Both bases report the maximum, the peak date, the trough date and the recovery date. The two numbers
usually differ: with monthly deposits the balance is propped up, so the balance drawdown is typically
shallower than the NAV drawdown over the same episode.

## Chart Presentation

The performance card offers two views over the same simulation, and both respond to the cashflow
configuration.

| View | Series | Axis |
| --- | --- | --- |
| Portfolio Value | account balance in dollars | currency |
| Return on Capital | profit ÷ capital committed so far | percent |

### Return on capital

```text
profit(t)   = balance(t) + actual withdrawals to t − deposits to t − initial capital
committed(t)= initial capital + deposits to t
return(t)   = profit(t) / committed(t) × 100
```

This is the investor's own percentage: a deposit raises the denominator and therefore dilutes the
ratio, a withdrawal does not erase profit that has already been earned, and a loss shows as a
negative percentage. In the flat-then-rising fixture used by the tests, `$1,000` monthly deposits
produce `0 → 10 → 9.09 → 20 → 18.33 → 30.17` while the same run with withdrawals produces
`0 → 10 → 10 → 20 → 20 → 30`.

It is deliberately *not* the time-weighted return. TWR compounds the investment and ignores external
flows, so it belongs in the Performance Summary and the drawdown, not on a chart whose job is to show
what the investor experienced.

Rules:

- Both views read the three account contracts; neither falls back to the raw NAV.
- The range filter slices the single simulation. A `1Y` dollar view shows the balance the investor
  actually held one year ago, not fresh opening capital.
- Return on capital is an absolute measure since the account opened, so a range only zooms the
  x-axis; the series is never rebased.
- The tooltip always shows the balance and the return on capital for the hovered date.
- Log scale is offered in both views and is automatically withdrawn when a value is non-positive
  (a depleted account at `$0`).
- The annual and monthly tables below the chart still report flow-neutral TWR, because a monthly
  percentage that silently included a deposit would not be a return. Each table carries a caption
  saying so.

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
- The Python response includes independent account ledgers for Strategy, SPY and SPMO, each with a
  `balance_drawdown` series and `max_balance_drawdown_pct`.
- For the exact submitted full window, the UI consumes the Python balances, units, TWR and XIRR.
- The browser engine runs only when no authoritative payload matches the submitted configuration
  (the inflation-adjusted view), and produces the same contract.
- The headline return card reads the investor's XIRR whenever cashflows are enabled and shows the
  flow-neutral TWR beneath it; with cashflows disabled it reads the TWR directly.
- The performance chart's second view is return on capital, so both views move when the direction,
  amount or frequency changes.
- The Performance Summary carries TWR, XIRR, Net P&L and both drawdown bases as separate tiles.
- The workbook adds an Annual Returns sheet, an Account Balances sheet, a strategy account-balance
  drawdown column, and a return-on-capital column for each of the three accounts.
- The Cash Flows sheet contains requested, actual and unpaid strategy withdrawals.

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

`data-service/tests/test_cashflow_accounting.py` and `frontend/tests/backtest-accounting.test.mjs`
assert the same hand-calculated scenario table in both engines:

| # | Scenario | Shared expectation |
| --- | --- | --- |
| 1 | Flat market, no flows | `$10,000`, TWR `0`, drawdown `0` |
| 2 | Flat market, monthly inflows | `$12,000`, MWR `0` |
| 3 | Flat market, monthly outflows | `$8,000`, MWR `0` |
| 4 | Rising market, inflows | `12,000 → 13,200 → 14,200 → 15,620`, TWR `+33.1%` |
| 5 | Rising market, outflows | `11,000 → 10,000 → 11,000`, TWR `+33.1%` |
| 6 | Falling market, inflows | `10,000 → 9,000 → 9,000`, TWR `−27.1%` |
| 7 | Falling market, outflows | `… → 5,580`, TWR `−27.1%` |
| 8 | Crash with withdrawals | actual `5,000`, unpaid `7,000`, balance `0` |
| 9 | Withdrawal above balance | capped, shortfall recorded |
| 10 | Exact depletion | balance, units, cash all `0` |
| 11 | Inflow after depletion | `0 → 5,000 → 5,500`, TWR `+10%` |
| 12 | Identical schedules | same dates and amounts on all three accounts |
| 13 | Different NAVs | same flows, different balances |
| 14 | TWR under a large deposit | identical to the no-flow TWR series |
| 15 | Flow timing | same TWR, different XIRR |
| 16 | Investment drawdown | `−30%` from the NAV, unaffected by a deposit |
| 17 | Account drawdown | follows the balance, includes the withdrawal |
| 18 | Inflation-adjusted flows | scaled once, in base-date dollars |
| 19 | Narrowed window | sliced balances, rebased TWR |
| 20 | Annual and monthly rows | flow-neutral and identical to the page's rows |

The critical case (initial `$10,000` → `$12,000` → withdraw `$12,000`) is asserted in both suites:
executed `$12,000`, unpaid `$0`, ending balance `$0`, zero units, TWR `+20%`, XIRR from the two dated
flows, and account drawdown `−100%`.

Frontend tests additionally cover:

- backend account normalization and consumption, and mismatch fallback to the local account;
- strategy-only entry cost and full-capital benchmark start;
- both chart views reading their own series, and the view/range/drawdown controls;
- the account-drawdown caption and the account-balance export column;
- Account Balances, Annual Returns and Cash Flows exports.

## Manual Verification

The local application was exercised against the local FastAPI engine (publication through
2026-11-13) at 1440×1100.

| Scenario | Result |
| --- | --- |
| Monthly `$1,000` inflow, default window | Start `$10,000`, End `$312,963`, Investor Return `+21.1%`, TWR `+406.1%` |
| Same run, Portfolio Value view | Currency axis `$0 … $400K`; end labels `$312,963` / `$288,730` / `$237,304` |
| Same run, Return on Capital view | Percent axis `−20 … 250%`; end labels `+177.0%` / `+155.5%` / `+110.0%` |
| Same run, `1Y` range (value) | Axis `$150K … $350K`; the balance is the real one, not restarting at `$10,000` |
| Same run, `1Y` range (capital) | The same absolute percentages, zoomed; the series is not rebased |
| Drawdown, Investment basis | Max `−32.1%`, `2020-02-19 → 2020-03-23`, recovered `2020-07-06` |
| Drawdown, Account basis | Max `−30.3%`, `2020-02-19 → 2020-03-23`, recovered `2020-05-20` |
| Monthly `$1,000` outflow, re-run | End `$0` on all three accounts, Investor Return `+21.4%`, TWR `+416.5%` |

Hover tooltip at 2023-05-22, compared against the published account simulation:

```text
tooltip:  Strategy $107,616 (+51.6%)   SPY $96,104 (+35.4%)   SPMO $90,725 (+27.8%)
snapshot: Strategy $309,889.86         SPY $223,936.44        SPMO $330,668.00
```

The tooltip balances are the simulated balances to the cent. `$107,616` against `$71,000` committed
by that date is `+51.6%`, which is the return on capital at that point in the curve.

## Test and Build Evidence

```text
npm test
162 Python tests passed
309 frontend tests passed

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

Commit `94254e4` was pushed to `main`; no history was rewritten and no other branch was touched.

- Workflow: `Deploy to GitHub Pages`, run `43611458480`
- Status: completed / success
- Deployed URL: https://andyttc05.github.io/us-momentum-terminal/
- Deployed bundle: `assets/index-DloS5ZoF.js`, which contains the new `Portfolio Value` and
  `Investor Return` strings

The live Backtesting page was loaded in headless Chrome against the deployed build and reported:

```text
Start Balance      $10,000
End Balance        $312,963
Duration           8y 7m
Investor Return    +21.1%   (XIRR · TWR +406.1%)
Drawdown badge     Max −32.1%
Drawdown caption   Max −32.1% · 2020-02-19 → 2020-03-23 · recovered 2020-07-06
Chart axis         $0 / $100K / $200K / $300K / $400K
End labels         $312,963 / $288,730 / $237,304
Active view        Portfolio Value
```

`GET https://us-momentum-data.onrender.com/api/snapshot` returned `200` for publication
`2026-11-14-cashflow-accounts-v14` with a strategy `final_value` of `$312,962.59`, matching the
deployed page to the dollar. That payload predates this change, so it carries no
`balance_drawdown` field; the browser derives the series from the published balances, which is why
the live account drawdown and caption render correctly regardless of when Render finishes
redeploying. A later publication build will publish the field directly.

## Remaining Limitations

- Individual held securities are not simulated share-by-share for user cash flows. The account
  redeems total-return portfolio units proportionally, which preserves portfolio weights and market
  value but does not model tax lots or security-specific sale selection.
- External cash flows do not add a separate transaction charge. Portfolio rebalances retain their
  configured 10 bps transaction cost and slippage.
- Inflation-adjusted mode uses the frontend real-dollar account path because CPI publication dates
  are a display-time alignment concern. Its account identity and non-negative floor remain tested.
- Account-balance drawdown is sampled at the close *after* each external flow, so a deposit that
  arrives mid-decline can lift the balance above its previous high-water mark and reduce the recorded
  balance drawdown. That is a property of the measurement, not a defect; the investment drawdown
  remains the risk metric for that reason.
- Annual and monthly tables intentionally report flow-neutral returns. They are not account growth
  rates, and the caption under each table says so.
- Return on capital is a cumulative level, not a rate: it is not annualised, and it cannot be
  chain-linked across sub-periods the way TWR can. The Performance Summary keeps both measures so the
  two are never confused.
- Deployments that serve a publication generated before this change will compute
  `balance_drawdown` in the browser from the published balances; the values agree, but the field is
  absent from the JSON until the next publication is generated.
- Historical survivorship, point-in-time float shares, sector history and delisting returns remain
  the limitations documented in the broader quantitative audit.
- Production deployment is restricted by repository environment rules to protected branches; the
  tested commit was deployed through `main`.

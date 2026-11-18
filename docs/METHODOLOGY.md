# Investment and Backtesting Methodology

This document describes the calculations used by US Momentum Terminal. The project is a research
model; it does not execute broker orders.

## 1. Stock universe

The current universe contains 200 curated US equities: 108 audited core names and 92 sector-balanced
additions. A normal publication has fewer than 200 eligible stocks because some names fail security,
price, history, or liquidity checks.

Every requested price series must be present before a static publication is accepted. A provider
omission is not treated as an eligibility exclusion. Individual failures are recorded with the ticker
and failure stage.

The universe checks include:

- NYSE, Nasdaq, or NYSE American listing;
- common-stock security type;
- USD currency;
- minimum close of $5;
- sufficient clean price observations;
- average daily dollar volume of at least $2 million over the latest 63 sessions.

Universe eligibility and momentum eligibility are separate. An eligible stock can still lack enough
history for a Momentum Score.

## 2. 12–1 momentum

The primary signal is:

```text
12–1 momentum = P(t−21) / P(t−252) − 1
```

`P` is the adjusted close. The 21-session skip removes approximately the latest month, while the
252-session lookback covers approximately one year. The observation window contains 232 closes from
`t−252` through `t−21`, producing 231 daily returns.

The skip month is excluded from both the return numerator and the volatility estimate. This prevents
a very large recent move from increasing the risk denominator of a signal that deliberately ignores
that move.

At least 253 observations are required for ranking.

## 3. Risk adjustment and Momentum Score

Daily volatility is the sample standard deviation, with one degree of freedom, of the 231 returns in
the same 232-close window.

```text
risk-adjusted momentum = 12–1 momentum / daily volatility
```

Risk-adjusted momentum is standardized across the calculation-date cross-section:

```text
Z = (value − cross-sectional mean) / population standard deviation
Z = clip(Z, −3, +3)
```

The score remains positive and preserves the ranking:

```text
Score = 1 + Z        when Z > 0
Score = 1            when Z = 0
Score = 1 / (1 − Z)  when Z < 0
```

Scores are calculated once for the complete eligible cross-section. Top 20 and Top 100 use the same
scores and do not receive separate standardizations.

## 4. Selection

Portfolio-investable stocks are sorted by:

1. Momentum Score, descending;
2. risk-adjusted momentum, descending;
3. ticker, ascending.

The production model selects exactly 100 holdings. The application also publishes a 20-holding
research view. For the same dataset, Top 20 is the first 20 names in the Top 100 ranking.

Market capitalization does not reorder the selection. It affects only the weights of the names
already selected.

## 5. Current portfolio weighting

The production weighting rule is square-root relative size:

```text
raw weight = Momentum Score × (float cap / median float cap) ^ 0.5
```

Float capitalisation is current float shares multiplied by current price. Weights are normalized to
100%, then passed through a constrained solver:

- maximum single-stock weight: 9%;
- maximum combined sector-group weight: 35%;
- fully invested target: 100%.

The 35% cap applies to combined solver groups, not only individual GICS-style sectors. Consumer
Discretionary and Consumer Staples form one Consumer group. The remaining smaller groups are combined
into an Others group for the constraint calculation.

If the selected names cannot satisfy the constraints, the portfolio is unavailable and the reason is
published. The solver never substitutes a different ranking or invents weights.

## 6. Active portfolio lifecycle

The live ranking changes with every data refresh. The active model portfolio changes only after a
scheduled rebalance.

The semiannual schedule uses the final observed session of March and September as the signal date.
Execution occurs at the next available session close. A candidate book remains pending until that
execution session is present and its prices are available. The candidate must pass all portfolio
constraints before becoming active.

Top 20 and Top 100 maintain independent active books. GitHub Pages is the durable checkpoint for
active state: each workflow recovers the last deployed publication before constructing a replacement.
This prevents an ephemeral Actions runner from resetting the active portfolio.

The active portfolio is a simulated research allocation. It does not represent executed trades.

## 7. Backtesting

Backtests support monthly, quarterly, semiannual, and annual schedules. The initial book forms at the
selected start. Later signals use the final trading session of the scheduled month; trades execute at
the next available adjusted close.

Selection uses the same Momentum Score and tie-break rules as the current portfolio. The historical
size input depends on the data genuinely available at the signal date:

| Historical input | Label |
| --- | --- |
| Complete point-in-time float capitalisation | `score-size` |
| Point-in-time shares outstanding and split-normalized price | `score-size-proxy` |
| Incomplete size history | `equal-weight-proxy` |

Configured providers do not supply historical float shares. The shipped backtests therefore use the
point-in-time outstanding-share proxy and publish `live_weighting_tested: false`. Current float data is
never inserted into a past date. The historical proxy must not be described as validation of the
current float-cap rule.

Assumptions:

- transaction cost: 0.10% of traded notional;
- slippage and risk-free rate: 0%;
- benchmarks: SPY and SPMO over the strategy’s selected window;
- total-return mode: provider adjusted close;
- dividend-exclusive mode: split-normalized close with dividends retained as cash.

## 8. Cash-flow accounts

Strategy, SPY, and SPMO maintain independent unit accounts. Each receives the same requested flow
schedule.

```text
account value = units × NAV + available cash
```

A deposit buys fractional total-return units after that session’s investment return. A withdrawal
uses available cash first, then redeems units. Withdrawals are capped at account value, with any
shortfall recorded as unpaid.

Time-weighted return links the underlying NAV and is independent of deposits and withdrawals.
Money-weighted return is the annualized XIRR of actual dated investor cash flows. Net profit and loss
include actual withdrawals but exclude unpaid requests.

A depleted account remains at zero until a later valid deposit. Market movement cannot create value
from zero units and zero cash.

## 9. Performance metrics

- Volatility, tracking error, and downside deviation use daily returns and are annualized with
  `sqrt(252)`.
- Sharpe and Sortino assume a 0% risk-free rate.
- Beta is covariance with the benchmark divided by benchmark variance.
- Information ratio is mean active return divided by active-return volatility.
- Investment drawdown uses unitized NAV and a running peak.
- Account drawdown uses the cash-flow-inclusive account balance and a running peak.
- CAGR uses a 365-day basis.
- The opening calendar period includes the initial entry transaction cost.

The first calendar period starts from the initial capital, not from the post-cost NAV. Frontend
metrics for a full published window consume backend values; narrowed windows use the same conventions
in the browser.

## 10. Data validation

Static publication is rejected if any requested price series is missing, any series is incomplete or
unadjusted, provider connection failed, either portfolio is unavailable, either required backtest is
missing, weights do not total 100%, portfolio counts differ from their exact targets, stock details are
materially incomplete, or the market date is older than the allowed publication age.

The exporter writes to a temporary directory and replaces the live data only after full validation. A
failed refresh preserves the previous valid publication.

## 11. Research limitations

- The universe is curated and current, not a point-in-time security master.
- Historical membership introduces survivorship and selection bias.
- Historical float shares and point-in-time sector classifications are unavailable.
- Delisting returns, taxes, market impact, borrow costs, partial fills, and capacity limits are not
  modelled.
- Trades use the next available close rather than a broker execution feed.
- Yahoo Finance is unofficial and has no service-level guarantee.
- The GitHub Pages publication is a scheduled snapshot, not a real-time trading feed.
- Extreme provider price movements are flagged or excluded by validation; they are not repaired with
  synthetic data.

Backtested performance is not live performance and does not guarantee future results.

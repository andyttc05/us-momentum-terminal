# Quantitative Methodology — Source Rules and Required Tests

This document records the strategy logic defined in the original proposal and detailed project guide. It is the source of truth for calculation implementation unless a decision is explicitly revised and versioned.

## 1. Eligible stock universe

| Rule | Requirement |
|---|---|
| Market | United States |
| Exchanges | NYSE, NASDAQ, NYSE American |
| Security type | Common stocks |
| Exclude | ETFs, bonds, warrants, preferred shares |
| Minimum price | $5 |
| Minimum market capitalisation | None |
| Minimum trading history | 13 months proposed; pending Product Owner's final approval |
| Liquidity | 3-month average daily dollar volume >= $2 million |
| Initial size | Approximately 500–1,000 stocks |

Every excluded ticker should have an exclusion reason recorded.

Keep basic universe eligibility distinct from momentum-calculation eligibility. A security may meet listing, security-type, price and liquidity rules but lack sufficient observations for the primary 12–1 calculation. Such a security remains identifiable in the universe, but it is not eligible for a standard 12–1 momentum score until the required history is available.

### Dollar volume

`Daily Dollar Volume[d] = Price[d] × Volume[d]`

`3M ADTV = Mean(Daily Dollar Volume over latest 3 months of trading sessions)`

Use a consistent, documented price basis. This is a rolling average, not a single-day threshold.

## 2. Price-data convention

The detailed guide recommends consistent corporate-action handling and says stock splits must not create artificial jumps. For a price-momentum interpretation, prefer split-adjusted prices; treat dividends separately in portfolio total-return accounting. Do not silently assume dividend-adjusted `Adj Close` is identical to price momentum. If dividend-adjusted data is chosen, explicitly label it a total-return momentum variant.

The guide has a price-field ambiguity between the momentum-price convention and the daily-return formula using adjusted close. This must be locked in `OPEN_DECISIONS.md` and applied consistently.

Use daily data but map calendar months to the nearest prior available trading session. Prefer month-end reference dates over fixed assumptions such as exactly 21 trading days per month.

## 3. Standard 12–1 month momentum

The latest month is excluded.

Conceptually:

`Momentum Value = (Price one month ago / Price thirteen months ago) - 1`

That is, compare the price at approximately t-1 month with the price at approximately t-13 months. Use month-end/date-offset lookup rather than a hard-coded day count wherever possible.

## 4. History requirement and fallback policy

The Product Owner has directed that standard 12–1 momentum be the primary methodology, with approximately 13 months of usable historical prices required for a valid calculation. Download approximately 14 months of history to provide a buffer for month-end-to-prior-trading-session mapping, non-trading days, and missing observations. The proposed minimum trading-history filter is being changed from 10 to 13 months, **subject to final Product Owner approval**; until approved, represent it as a pending configuration decision rather than a silently locked default.

Do not use a nine-month fallback as standard 12–1 momentum. A shorter-lookback experiment, if ever desired, must be separately named, configured, and reported as a distinct methodology rather than mixed into the primary ranking.

Basic universe eligibility and momentum eligibility are different statuses: eligible listings may be retained with a `momentum_ineligible_reason` such as `insufficient_12_1_history`; they must not receive an invented momentum value or enter cross-sectional score statistics.

## 5. Daily-return volatility and risk adjustment

The proposal says daily-return volatility is measured over the same window as momentum.

`Daily Return[d] = Price[d] / Price[d-1] - 1`

`Daily Volatility = Standard Deviation(daily returns in the measurement window)`

Do not silently annualise before ranking. If annualised volatility is displayed, calculate it separately:

`Annualized Volatility = Daily Volatility × sqrt(252)`

`Risk-Adjusted Momentum = Momentum Value / Daily Volatility`

Flag missing, zero-volatility, non-finite or insufficient-observation cases. Do not divide by zero or assign an invented score.

## 6. Cross-sectional Z-score

For each calculation date, compute across the same eligible comparison universe:

`Z = (Stock Risk-Adjusted Momentum - Universe Mean) / Universe Standard Deviation`

Then cap:

`Capped Z = min(3, max(-3, Z))`

Record the comparison-universe count and calculation version. Handle zero cross-sectional standard deviation explicitly.

## 7. Momentum Score transformation

Required piecewise transformation:

- If `Z > 0`: `Momentum Score = 1 + Z`
- If `Z < 0`: `Momentum Score = 1 / (1 - Z)`
- If `Z = 0`: `Momentum Score = 1`

Use capped Z as the input to the transformation unless the methodology is deliberately revised and documented. The score must be positive; higher means stronger relative risk-adjusted momentum.

## 8. Selection modes

### Top 100

Sort eligible securities by Momentum Score descending and select up to 100. If fewer than 100 qualify, select all eligible securities.

### Top 20% / Top Quintile

Sort descending and select approximately 20% of eligible securities. The rounding convention is an open decision; the original guide recommends nearest integer with a minimum of one when the universe is non-empty.

A selection buffer to reduce turnover is an optional later enhancement, not an MVP requirement.

## 9. Float-adjusted market capitalisation

Preferred:

`Float-Adjusted Market Cap = Share Price × Float Shares`

or:

`Float-Adjusted Market Cap = Total Market Cap × Free-Float Factor`

Keep these quantities separate in storage, calculations, labels, and UI:

- **Total market capitalisation** = market price × total shares outstanding for the specified security/share classes and timestamps.
- **Shares outstanding** is the issuer's reported outstanding share count. Preserve the observation's measurement/effective date and its public filing/availability date.
- **Public float** is commonly reported by the SEC as an aggregate dollar value of equity held by non-affiliates at a specified reference date. SEC `EntityPublicFloat` is a currency amount, not a float-share count.
- **Float shares** are the share units considered publicly available under a defined float methodology. Do not equate them with total shares outstanding or an SEC public-float dollar amount.
- **Float-adjusted market capitalisation** = price × point-in-time float shares, or total market capitalisation × a point-in-time free-float factor from a documented source.

Do not label total market cap as float-adjusted market cap. If float data is unavailable, either exclude the security from portfolio construction or use clearly labelled total market cap as a provisional approximation. The policy must be confirmed and shown in methodology metadata.

For historical market capitalisation and portfolio weights, use shares/float observations that were public and available as of the historical decision timestamp. Keep `effective_date`/`period_end` separate from `filed_at`/`known_at`. Never backfill a past date with today's shares outstanding without an explicit look-ahead-bias flag; such observations cannot support an unbiased backtest.

## 10. Raw portfolio weights

`Raw Weight[i] = Float-Adjusted Market Cap[i] × Momentum Score[i]`

`Initial Weight[i] = Raw Weight[i] / Sum(Raw Weights)`

Initial normalized weights sum to 100% before applying constraints.

## 11. Portfolio constraints

| Constraint | Target |
|---|---:|
| Maximum single-stock weight | 9% |
| Maximum sector weight | 35% |
| Target holdings | 100 |
| Invested capital | 100% |

These are project-specific portfolio controls. The 35% sector cap is custom and must not be described as a direct SPMO rule.

### Iterative redistribution

A one-time cap is insufficient. Repeatedly cap excess stock/sector weights and redistribute to eligible uncapped holdings/sectors using the agreed redistribution method. Recalculate until:

- All stock weights are at or below 9%.
- All sector totals are at or below 35%.
- Weights are non-negative.
- Total portfolio weight is 100% within tolerance.

If constraints are infeasible (for example, too few eligible securities/sectors), return a clear failure/infeasible status. Never silently violate limits to force 100% investment. The exact redistribution algorithm is an open implementation decision and must be deterministic and unit-tested.

## 12. Daily ranking vs rebalancing

- Daily scan: refresh price data and rankings after each US trading session.
- Semiannual portfolio rebalance: March and September.
- Daily rank movement does not automatically change official model holdings.
- Between rebalance dates, mark current model holdings to market.

## 13. Backtest methodology

For each historical rebalance:

1. Rebuild historical eligible universe using information available at that point in time.
2. Use only prices/fundamentals known at the rebalance reference date.
3. Calculate momentum, volatility, risk-adjusted momentum, Z-score and score.
4. Select Top 100 or Top 20%.
5. Calculate market-cap × score weights.
6. Apply constraints.
7. Hold to next scheduled rebalance; mark to market daily.
8. Apply transaction costs/slippage when weights change.
9. Compare with SPY and SPMO over matching dates.

Required metrics:

- Total Return
- CAGR
- Annualized Volatility
- Sharpe Ratio (risk-free rate assumption documented)
- Maximum Drawdown
- Turnover
- Annual Returns

Avoid look-ahead bias, survivorship bias, corporate-action errors, unrealistic execution assumptions and stale point-in-time fundamentals. If required historical data is unavailable, disclose the limitation; do not claim an unbiased backtest.

## 14. Required unit tests

- Synthetic known price series produces expected 12–1 return.
- Most recent month is excluded.
- Approximately 13 months of usable history is required for standard 12–1; downloading approximately 14 months provides a buffer. The minimum universe-history configuration remains pending final approval.
- A security with insufficient history can remain in the basic universe but is excluded from momentum score/ranking calculations with an explicit reason.
- Volatility uses the same chosen window and handles insufficient/zero observations.
- Risk-adjusted momentum rejects invalid divisions.
- Z-score uses correct cross-sectional universe and stays within [-3, +3].
- Momentum Score exactly matches the piecewise formula.
- Top 100 and Top 20% selection work with tie/rounding rules documented.
- Raw weights sum to 100% before constraints.
- Final weights are non-negative and meet both caps when feasible.
- Infeasibility is explicitly reported.
- Backtest uses point-in-time data and matching benchmark dates.

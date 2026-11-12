# Strategy Validation Report

Validation date: 12 November 2026  
Data as-of: 11 November 2026  
Automated unit tests: 13 passed
Live integration verification: passed  
Sensitivity output: `data-service/docs/strategy_sensitivity.json`

## 1. Strategy Implementation Review

The implementation was reviewed from source code rather than inferred from project prose. The
following issues were confirmed and corrected:

- The cross-sectional score previously combined four linearly weighted factors. It now uses the
  requested risk-adjusted momentum Z-score and asymmetric piecewise score.
- Risk adjustment previously divided percentage momentum by annualized percentage volatility. It
  now divides the decimal 12-1 return by the sample standard deviation of daily returns.
- Portfolio raw weights previously ignored Momentum Score. They now use float-adjusted market cap
  × score.
- The displayed "Float-Adj. Market Cap" previously contained ordinary market cap. It now contains
  current provider float shares × latest price.
- The sector cap was 34% while the UI stated 35%. It is now 35% for the displayed sector groups.
- The backtest previously used monthly equal-weight rebalances and no costs. It now forms signals
  in March and September, executes at the next session and applies 0.10% transaction costs.
- The backtest previously allowed benchmark ETFs into the ranked stock set. Candidate selection is
  now restricted to the stock universe.

### Implementation Status

| Item | Classification | Evidence |
|---|---|---|
| 12-1 price window | PASS | `P(t-21) / P(t-252) - 1` verified from source and independent recomputation |
| Adjusted-close convention | PASS | Missing adjusted closes are dropped; unadjusted closes are not substituted |
| Universe eligibility | WARNING | Rules remain enforced across a 200-symbol source list (108 core + 92 additions), but this is still not a complete exchange master |
| Ten-month versus 13-month history | PASS as handling | Universe eligibility begins at 210 observations; scoring requires 253 observations and no shorter momentum window is used |
| Daily return volatility | PASS | Sample standard deviation over 252 daily adjusted returns |
| Risk-adjusted momentum | PASS | Decimal 12-1 return divided by daily standard deviation |
| Cross-sectional Z-score | PASS | Population standard deviation over the same eligible cross-section; clipped to [-3, 3] |
| Piecewise Momentum Score | PASS | Boundary tests at Z = -3, -1, 0, 1 and 3 |
| Descending ranking | PASS | Score, then risk-adjusted momentum and ticker produce deterministic ordering |
| Top 100 and Top 20% | PASS | Top 100 is capped at 100 rows; Top 20% uses ceiling of the current eligible count |
| Current portfolio raw weight | PASS | Float-adjusted market cap × score |
| Stock and sector caps | PASS | Feasible live book reaches 100%; maximum stock 9%, maximum sector group 35% |
| Infeasible portfolio handling | PASS | Unit test confirms unavailable state and reason instead of violating caps |
| Semiannual rebalance months | PASS | 18 historical rebalances occurred at March and September signals |
| Next-session execution | PASS | Every logged execution date is after its March/September signal date |

## 2. Calculation Verification

### 12-1 Momentum

The engine evaluates the latest observation at position `t`:

```text
P(t - 21) / P(t - 252) - 1
```

The newest 21 sessions are not part of the numerator. AAPL, MSFT, NVDA, META and JPM were
recomputed from raw bars and matched the application within the published rounding tolerance.

### Volatility

The trailing 253 prices produce 252 daily returns:

```text
daily volatility = sample standard deviation of 252 returns
annualized volatility (%) = daily volatility × sqrt(252) × 100
```

The annualized field is used only for display. The risk adjustment uses daily volatility.

A cash-only or malformed series with zero or non-finite volatility is rejected instead of producing
an infinite result. Missing days are absent observations, not zero returns. A series with a missing
adjusted close drops that observation before calculation.

### Z-Score And Score

The cross-section contains the same momentum-eligible stocks used for ranking. A zero standard
deviation produces neutral Z-scores of zero. The cap is applied before the score transform:

```text
z = clip((risk_adj - cross-sectional mean) / population standard deviation, -3, 3)
```

The score transformation passes these boundary tests:

| Z-score | Momentum Score |
|---:|---:|
| -3 | 0.25 |
| -1 | 0.50 |
| 0 | 1.00 |
| 1 | 2.00 |
| 3 | 4.00 |

Higher Momentum Scores correspond to better rankings.

### Live Integrity Results

- Published universe: 200 scanned, 200 loaded, 198 eligible.
- Excluded: TSM for ADR security type; PARA for a sub-$5 reused ticker.
- Removed from the live source list: delisted WBA.
- Published cross-sectional date: 11 November 2026.
- Portfolio: 100 holdings, 100.000000% total weight.
- Maximum stock: 9.000000%.
- Maximum sector group: 35.000000%.
- Maximum raw-weight formula error: 0.000049 percentage points.
- Rank order: consistent with score and tie-break rule.
- Live verification result: PASS.

## 3. Backtesting Logic Review

### Signal And Execution Timeline

For each rebalance:

1. Score stocks with the last available close in March or September.
2. Record the signal at the final trading session of that month.
3. Execute at the next available adjusted close.
4. Hold and mark the book to market daily.
5. Rebalance again at the next March or September signal.

This removes same-bar execution and prevents a signal at close from being purchased at an earlier
price.

### Weighting And Costs

The historical book is equal-weighted. This is a documented research proxy, not the live model
portfolio's float-cap weighting. Current float shares cannot be applied to past dates without
look-ahead bias, and the current provider does not supply historical float market cap.

Transaction cost is 0.10% of the traded buy and sell notional. Cost is charged only when the book is
formed or rebalanced, not on every daily mark-to-market observation. Slippage is 0%.

The base Top 100 backtest:

- Window: 2 April 2018 through 11 November 2026.
- Rebalances: 18.
- Initial trade cost: 0.10% of initial capital.
- Cumulative transaction cost: 0.9497% of the initial $100 index.
- Total one-way turnover: 265.3%.
- Annualized one-way turnover: 30.9%.

### Metric Verification

| Metric | Classification | Notes |
|---|---|---|
| Total Return | PASS | Daily NAV from first executable book to final date |
| CAGR | PASS | Uses actual calendar days |
| Annualized Volatility | PASS | Daily NAV return standard deviation × sqrt(252) |
| Sharpe Ratio | WARNING | Formula is validated with an explicit 0% risk-free rate; changing that assumption changes the metric |
| Maximum Drawdown | PASS | Minimum peak-to-trough daily NAV decline |
| Annual Return | PASS | Calendar-year returns with YTD last year |
| Portfolio Turnover | PASS | One-way turnover at each scheduled rebalance |
| Benchmark dates | PASS | SPY and SPMO are aligned to the strategy start and end |
| Benchmark return convention | PASS | Adjusted closes |
| Dividend inclusion | PASS for sampled data | Adjusted closes include dividend effects; compensation of the adjusted series by the provider is not independently fully verified |

## 4. Bias And Execution Risk

| Risk | Classification | Assessment |
|---|---|---|
| Feature look-ahead | PASS for price inputs | Signals use observations through the signal date only and execute next session |
| Historical market-cap look-ahead | PASS by avoidance | Historical cap weighting is not used |
| Survivorship bias | FAIL | Live scan is broader, but historical tests intentionally remain on the audited 108-symbol core; delisted and acquired names are incomplete |
| Point-in-time constituent bias | FAIL | No historical constituents or security master |
| Ticker-change risk | FAIL | No stable historical security identifier; PARA exposed a reused-symbol collision |
| Benchmark inclusion | PASS after correction | SPY and SPMO are excluded from candidate ranking |
| Same-bar execution | PASS | Next-session execution is enforced |
| Missing-day handling | PASS for scored series | Missing adjusted observations are dropped; no synthetic zero return is inserted into momentum |
| Daily rebalance leakage | PASS | Backtest rebalances semiannually despite daily marking |
| Cost application | PASS | Applied to actual traded notional at formation and rebalances |
| Delisting return | FAIL | No explicit delisting-return model |

The highest-impact remaining backtest issue is not a calculation error. It is that the historical
universe and security history are not point-in-time. This prevents treating the result as a
production-faithful reconstruction of the complete US market.

## 5. Robustness And Sensitivity Tests

These are exploratory historical comparisons. They are not an optimisation exercise and do not
establish that the preferred parameter will perform well in the future.

| Scenario | CAGR | Max Drawdown | Sharpe, 0% RF | Annual Turnover |
|---|---:|---:|---:|---:|
| Base Top 100, semiannual | 19.6% | -34.7% | 1.05 | 30.9% |
| Top 50 | 20.3% | -32.9% | 1.03 | 85.8% |
| Top 20% | 23.1% | -32.1% | 1.05 | 129.4% |
| 0 bp cost | 19.7% | -34.7% | 1.05 | 30.9% |
| 25 bp cost | 19.5% | -34.7% | 1.04 | 30.9% |
| 50 bp cost | 19.4% | -34.7% | 1.04 | 30.9% |
| Base + 10 bp slippage | 19.5% | -34.7% | 1.05 | 30.9% |
| Base + 25 bp slippage | 19.4% | -34.7% | 1.04 | 30.9% |
| Monthly rebalance | 19.0% | -34.3% | 1.03 | 63.6% |

The monthly result begins on 1 December 2017 because it has a qualifying month before the first
March in the semiannual series. Its start date is therefore not identical to the base result.

### Historical Periods

| Period | Total Return | CAGR | Annualized Volatility | Max Drawdown | Classification |
|---|---:|---:|---:|---:|---|
| 2018-2022 | 110.6% | 17.0% | 22.1% | -34.7% | In-sample historical period |
| 2023-through-latest | 122.2% | 23.0% | 13.8% | -18.7% | Chronological holdout |
| 2020 second half | 64.4% | 93.9% | 23.5% | -8.2% | Strong recovery period |
| 2022 | -12.4% | -12.5% | 23.1% | -22.6% | Bear-market period |
| 2023-2024 | 59.3% | 26.3% | 12.6% | -10.4% | Bull-market period |

The 2023-to-latest result is a holdout by date, not a model trained only on earlier data and then
launched without shared universe knowledge. The universe itself is current and therefore leaks
later listing knowledge into all periods.

### Universe-Size Exploration

The 50- and 75-stock subsets produced higher historical returns, but they were selected by today's
liquidity ranking. That selection is not point-in-time and cannot be treated as valid evidence of a
better strategy.

## 6. Key Findings

### Correct Implementation

The price window, volatility estimator, Z-score, score transformation, ranking, current portfolio
weight formula, cap enforcement, semiannual signal months, next-session execution and transaction
cost accounting are implemented and covered by tests.

### Reliable Data

The current cross-section has strong structural integrity, one common as-of date, no duplicate
dates or prices and a successful benchmark cross-check. It remains dependent on an unofficial
provider and is not a point-in-time market database.

### Statistically Robust Historical Performance

The base backtest remained positive under tested cost and slippage assumptions and across the
specified calendar periods. The result is not independently replicated on a second complete market
dataset. Sensitivity and holdout results reduce some operational concerns but do not replace
point-in-time constituents, paid fundamentals history or out-of-market tests.

### Real-World Investment Suitability

**NOT ESTABLISHED.** The project has no live execution, capacity analysis, tax model, borrow or
financing assumption, corporate-action exception process, transaction-cost calibration or
paper-trading record. It is an academic research terminal, not a production portfolio engine.

## 7. Known Weaknesses

- Current source universe is broader but remains curated; the historical core retains survivorship
  and selection bias.
- No point-in-time history for delisted securities or market constituents.
- Equal-weight historical proxy instead of the live float-cap portfolio.
- No historical float-adjusted market cap.
- No stable security identifier for ticker changes and symbol reuse.
- Unofficial primary provider without an SLA.
- Current bar cache lacks per-row dividend and split metadata.
- Sharpe Ratio uses an explicit but simplistic 0% risk-free assumption.
- On-demand historical date controls slice a precomputed series; they do not rerun the signal
  production workflow.
- The application does not model taxes, market impact, capacity or live execution constraints.

## 8. Recommended Improvements

1. Obtain point-in-time US constituents, exchange listings and stable security IDs.
2. Obtain historical shares outstanding and float shares.
3. Build a delisting and merger return model.
4. Reproduce the float-cap and sector-cap portfolio historically at each semiannual date.
5. Add a second paid adjusted-close provider and compare every ticker within a stated tolerance.
6. Add walk-forward and rolling-window validation after point-in-time data is available.
7. Report benchmark alpha, tracking error and factor exposures for stronger performance attribution.
8. Document and support a configurable risk-free series rather than a single zero-rate assumption.

## Reliability Conclusion

The implementation now matches the specified calculation chain and the tested portfolio
constraints. The current dataset and the remaining execution assumptions do not support a claim that
the strategy is guaranteed, proven or generally reliable for future investment. The appropriate
description is: **correctly implemented for the specified methodology, structurally checked on the
available current data, and historically positive in an exploratory backtest that still has
unresolved point-in-time and survivorship limitations.**

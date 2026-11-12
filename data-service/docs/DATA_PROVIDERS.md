# Market Data Provider Report

Implementation reviewed: 12 November 2026
Raw probe evidence: `data-service/docs/provider_probe.json`

## Current Runtime Configuration

| Provider | Role | Credential | Current use |
| --- | --- | --- | --- |
| Yahoo Finance via `yfinance` | Primary | None | Adjusted and raw daily bars, actions, and current quote metadata |
| Twelve Data | Optional backup | `TWELVEDATA_API_KEY` | Enabled only when configured |
| Financial Modeling Prep | Optional backup | `FMP_API_KEY` | Enabled only when configured |
| Stooq | Optional unadjusted adapter | None | Not in the default chain |
| Alpha Vantage, Finnhub, Polygon | Research only | Respective key | Probed but not registered as production adapters |

The configured default is:

```text
DATA_PROVIDER_CHAIN=yahoo,twelvedata,fmp
```

Unavailable adapters are removed from the active chain at runtime. The publication records the
provider that supplied each stock, whether a backup was used, fetch time, and provider health.

## Yahoo Finance

Yahoo is the current production source for the full 200-symbol live universe. The adapter uses the
unofficial `yfinance` client, which performs the cookie/crumb handshake required by Yahoo.

It supplies:

- Daily open, high, low, close, adjusted close and volume.
- Dividend and split fields when available.
- Current company name, sector, exchange, currency, security type, market capitalization, shares
  outstanding, float shares and three-month average volume.

The service pages requests with a client-side rate limiter, loads history in bounded batches,
recovers unresolved symbols in a smaller worker pool, and preserves longer valid series when a
provider returns a truncated response.

Known limitations are the lack of a contractual SLA, occasional rate limiting, current rather than
point-in-time fundamentals, and no permission to redistribute provider market data.

## Twelve Data

Twelve Data requires an API key and is available as the first optional fallback. The adapter is rate
limited to the documented free-plan quota. The free plan does not reliably provide adjusted closes
for all securities, so an unadjusted series is rejected by the momentum engine.

The historical probe verified AAPL and QQQ through the public demo key; it could not verify the
full universe.

## Financial Modeling Prep

Financial Modeling Prep requires an API key. Its adapter requests adjusted end-of-day history and
quote metadata and is rate limited for a conservative free-plan workload.

The historical probe reached the API but received HTTP 401 without a real key. It has therefore not
been independently verified across the live universe.

## Stooq

The Stooq adapter can parse daily CSV export data, but Stooq does not provide adjusted close in that
format. The historical probe received an anti-bot challenge instead of CSV. The adapter therefore
raises a blocked/no-data condition and is not part of the default scoring chain.

## Failure and Caching Behaviour

The registry walks the configured provider chain per request. A failure is recorded and the next
available adapter is attempted. After three consecutive hard failures, a provider is temporarily
benched by a circuit breaker.

Expired bar caches are retained as an explicit fallback and marked cached with their age. A symbol
that cannot be served is excluded and listed in `universe.unavailable`; no placeholder price is
inserted.

The publication payload distinguishes:

- `fresh`: current provider-backed data.
- `cached`: previously verified data served while refreshing or after a live failure.
- `partial`: some symbols or providers failed.
- `warming`: no completed publication is available yet.
- `error` or `empty`: no usable market data is available.

## Reproducing the Probe

```bash
.venv-datatest/bin/python data-service/tests/provider_probe.py
```

The script writes structured evidence to `data-service/docs/provider_probe.json`. Provider
credentials are read from the git-ignored root `.env` or process environment and are never written
to the report.

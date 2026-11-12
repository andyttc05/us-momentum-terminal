# Market Data Provider Report

**Project:** US Momentum Terminal
**Executed:** 11 November 2026, 18:30–19:15 UTC (14:30–15:15 New York, market open)
**Harness:** `data-service/tests/provider_probe.py` (live network, no mocks)
**Raw evidence:** `data-service/docs/provider_probe.json`

Every number below comes from an actual HTTP request made from this machine. Where a provider
could not be tested, the report says so explicitly instead of assuming it works because the
marketing site loads.

---

## 1. Summary

| Question | Answer |
|---|---|
| Providers tested | 7 (Yahoo, FMP, Alpha Vantage, Finnhub, Twelve Data, Polygon, Stooq) |
| Providers fully verified without a key | **1 — Yahoo Finance (yfinance)** |
| Providers reachable but blocked by authentication | 4 (FMP, Alpha Vantage, Finnhub, Polygon) |
| Providers partially usable without a key | 1 (Twelve Data — 2 of 20 symbols with the public `demo` key) |
| Providers unreachable for programmatic use | 1 (Stooq — bot-verification wall, then refused connections) |
| Primary selected | **Yahoo Finance via yfinance** |
| Backup selected | **Twelve Data** (free key required) |
| Secondary backup | Stooq (adapter implemented, currently blocked in this network) |

Only Yahoo returned adjusted closes, market caps, splits and dividends for **all 20** sample
tickers. It is therefore the only provider that could carry the momentum engine on its own.

---

## 2. How the tests were run

* Plain `requests` calls with a browser User-Agent, 25 s timeout, status code + latency + body
  snippet captured for each call.
* Yahoo was exercised through the `yfinance` client (v1.8.0), because the raw
  `query1.finance.yahoo.com/v8/finance/chart` endpoint answered **HTTP 429** to a bare request
  (measured: 1.30 s, 429). yfinance performs the cookie → crumb handshake and retries, which is
  what makes the data reachable at all. That handshake is reproduced by the adapter.
* 20 sample tickers: AAPL, MSFT, NVDA, AMZN, META, AVGO, GOOGL, TSLA, AMD, NFLX, PLTR, ORCL,
  COST, WMT, JPM, XOM, LLY, BRK-B, SPY, QQQ.
* No subscription was purchased, no paid endpoint was called, and no key was fabricated.

### Reading the table

* **Connection** — did the host answer at all.
* **Authentication** — `Passed` (we got data), `API key required` (**we never got past auth — this
  is not a provider failure, it is an untested provider**), `Not required`.
* **Not tested** — the honest state for everything behind a key we do not have. It is *not* a
  verdict that the provider is bad.

---

## 3. Per-provider findings

### 3.1 Yahoo Finance (via yfinance) — **verified, primary**

| Test | Result |
|---|---|
| Direct chart endpoint (no handshake) | HTTP 429 after 1.30 s |
| yfinance client (cookie + crumb) | 20/20 symbols, median 466 ms/ticker |
| 2-year daily history (probe window) | 502 rows for every symbol |
| 10-year daily history (application load) | 2,513 rows for AAPL, e.g. (2,012 for PLTR, listed 2020) |
| Latest observation | 2026-11-11 (same session as the test) |
| Adjusted close | Present for all 20 symbols |
| OHLCV completeness | Complete for all 20 |
| Splits / dividends | `Dividends` and `Stock Splits` columns present for all 20 |
| Market cap | Present (e.g. AAPL 5.16 T USD, sector `Technology`) |
| Minimum observations across the universe | 1,209 (shortest listed history) |

Caveats: unofficial API, no published quota, aggressive 429s on the raw endpoint, ~15 min delay
during the session, and a licence that does not permit redistribution. Acceptable for this
single-user terminal; not acceptable as a redistributed data product.

### 3.2 Financial Modeling Prep — **not tested (key required)**

* `GET /api/v3/historical-price-full/AAPL?apikey=demo` → **HTTP 401**, body
  `{"Error Message": "Invalid API KEY. Feel free to create a Free API Key..."}` (2.1 s)
* `GET /stable/historical-price-eod/full?symbol=AAPL` → **HTTP 401**, same body (2.0 s)
* Documented free tier: 250 calls/day, EOD history and market cap (market cap limited to a
  symbol subset on Basic).
* Verdict: cannot be recommended or rejected without a key. Adapter is implemented and activates
  automatically when `FMP_API_KEY` is set.

### 3.3 Alpha Vantage — **not tested (key required)**

* `TIME_SERIES_DAILY_ADJUSTED` with the public `demo` key → **HTTP 200** but only an
  `Information` message: *"The **demo** API key is for demo purposes only…"* (1.4 s).
* Three symbols attempted with the demo key: 0 returned data.
* Documented free tier: 25 requests/day; `TIME_SERIES_DAILY_ADJUSTED` is a premium function.
* Verdict: unusable without a key. Even with one, 25 calls/day cannot refresh a 109-symbol
  universe.

### 3.4 Finnhub — **not tested (key required)**

* `/api/v1/quote?symbol=AAPL` → **HTTP 401** `{"error":"Please use an API key."}` (1.4 s)
* `/api/v1/stock/candle` → **HTTP 401** (same)
* Documented free tier: 60 calls/min; historic candles are not part of the free tier.
* Verdict: good for live quotes, not a viable history source on the free plan.

### 3.5 Twelve Data — **partially verified, selected as backup**

* `time_series` with the public `demo` key: **AAPL and QQQ returned data** (HTTP 200, latest
  2026-11-11); **18 of 20** symbols returned **HTTP 401** with
  *"The 'demo' API key is only used for initial familiarity…"*
* Median latency 1.21 s.
* Documented Basic (free) plan: 8 credits/minute, 800/day, EOD global equities included.
* Licensing caveat: the Basic plan is explicitly for *testing/evaluation* — production display
  requires a paid plan.
* Verdict: works, but needs a real key before it can cover the universe. That is exactly the role
  of a backup, so it is wired as the first fallback and disabled until a key exists.

### 3.6 Polygon.io — **not tested (key required)**

* `/v2/aggs/ticker/AAPL/range/1/day/...` with `apiKey=demo` → **HTTP 401**
  `{"status":"ERROR","error":"Unknown API Key"}` (1.8 s)
* Documented free tier: 5 requests/minute.
* Verdict: excellent data model (explicit `adjusted=true`), but 5 req/min cannot refresh 109
  symbols. Adapter not implemented beyond the probe; not in the chain.

### 3.7 Stooq — **reachable, data blocked**

* `https://stooq.com/q/d/l/?s=aapl.us&i=d` → **HTTP 200** but an HTML page:
  *"This site requires JavaScript to verify your browser."* — a bot-verification wall, not CSV.
* Same response for `stooq.pl` and with a cookie jar.
* On the final re-run the host refused the requests outright (`status: null`,
  connection reset) — i.e. the block tightened during testing.
* No adjusted close in the format even when reachable; no market cap.
* Verdict: not usable from this environment. Adapter exists, raises `ProviderBlocked` instead of
  inventing data, and sits after Twelve Data in the chain.

---

## 4. Comparison table

| Provider | Connection | Authentication | Historical Data | Adjusted Close | OHLCV | Market Cap | Symbol Coverage | Latest Data | Response Time | Rate Limits | Overall Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Yahoo Finance (yfinance) | Connected | Not required | Available | Available | Complete | Available | 20/20 | 2026-11-11 | 466 ms | None published; HTTP 429 observed. Paced client-side (120 req/min budget). | **Recommended — primary** |
| Financial Modeling Prep | Connected (HTTP reachable) | API key required | Not tested - no API key | Not tested | Not tested | Not tested | 0 tested | — | 2107 ms | 250 calls/day (documented) | Not tested (key required) |
| Alpha Vantage | Connected (HTTP reachable) | API key required | Not tested - no API key | Not tested | Not tested | Not tested | 0/3 | — | 1427 ms | 25 calls/day (documented) | Not suitable (25 req/day) |
| Finnhub | Connected (HTTP reachable) | API key required | Not tested - no API key | Not tested | Not tested | Not tested | 0 tested | — | 2953 ms | 60 calls/min; historic candles excluded from free tier (documented) | Not suitable (no free history) |
| Twelve Data | Connected | Passed (demo symbols only) | Available | Not verified | Complete | Not tested | 2/20 | 2026-11-11 | 1210 ms | 8 credits/min, 800/day (documented) | **Backup** (key required for coverage) |
| Polygon.io | Connected (HTTP reachable) | API key required | Not tested - no API key | Not tested | Not tested | Not tested | 0 tested | — | 1762 ms | 5 calls/min (documented) | Not suitable (5 req/min) |
| Stooq | Failed | Not required | Unavailable (requests refused) | Unknown | Unknown | Unavailable | 0/5 | — | — | No published limit; requests blocked during the test | Not suitable (blocked, unadjusted) |

`Response time` is the median of the successful (or first attempted) request per provider in the
final run. `Rate limits` are the provider's documented free-tier limits — marked *(documented)* —
since none of them can be observed without a key.

---

## 5. Phase 2 — 20-symbol matrix

The probe tested a 2-year window per symbol. The application loads 10 years; the row counts the
terminal actually holds are in `docs/verification.json`.

### Yahoo Finance: 20/20

| Symbol | Rows (2y test) | First | Latest | Adj. close | OHLCV | Market cap |
|---|---|---|---|---|---|---|
| AAPL | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $5.16T |
| MSFT | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $3.88T |
| NVDA | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $4.28T |
| AMZN | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $2.89T |
| META | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $1.64T |
| AVGO | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $1.69T |
| GOOGL | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $3.63T |
| TSLA | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $1.56T |
| AMD | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $929B |
| NFLX | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $263B |
| PLTR | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $418B |
| ORCL | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $406B |
| COST | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $477B |
| WMT | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $988B |
| JPM | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $914B |
| XOM | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $677B |
| LLY | 502 | 2024-11-11 | 2026-11-11 | yes | complete | $1.28T |
| BRK-B | 502 | 2024-11-11 | 2026-11-11 | yes | complete | — |
| SPY | 502 | 2024-11-11 | 2026-11-11 | yes | complete | — |
| QQQ | 502 | 2024-11-11 | 2026-11-11 | yes | complete | — |

### Twelve Data (demo key): 2/20

AAPL and QQQ only; the other 18 returned HTTP 401. With a free key the adapter uses the same
`time_series` endpoint with `outputsize` sized to the requested history.

### Everything else: 0 tested symbols

FMP, Alpha Vantage, Finnhub and Polygon rejected authentication before any symbol could be
requested. No symbol-level results exist for them and none are invented here.

---

## 6. Selected providers

### Primary — Yahoo Finance (yfinance)

Reasons, in order of weight:

1. **Only provider that passed symbol coverage** (20/20) without a key.
2. **Adjusted closes for every symbol** — mandatory, because momentum must never mix adjusted and
   unadjusted prices.
3. **Market cap, splits and dividends** in the same response family, so the portfolio weighting
   and corporate-action awareness use one consistent source.
4. **10 years of daily history** — needed for the 12-1 momentum window, volatility, the monthly
   rank history and the 2017-onward backtest.
5. Free, no signup, no quota negotiation.

Known weaknesses, all handled in code: unofficial endpoint, 429s, ~15 min delay, no SLA.

### Backup — Twelve Data (free key)

1. Same normalized daily OHLCV shape, trivial to map.
2. Free tier actually returns data (proven with AAPL/QQQ).
3. 800 requests/day is enough for a daily 109-symbol refresh with caching.
4. Fails over automatically only when a key is present; until then the system reports
   "primary unavailable" instead of pretending.

### Not selected

* **FMP** — plausible backup, but 250 calls/day and unverified without a key.
* **Alpha Vantage** — 25 calls/day cannot even refresh the universe once.
* **Finnhub** — free tier excludes historic candles.
* **Polygon** — 5 req/min is too slow for a 109-symbol sweep; excellent paid product.
* **Stooq** — unadjusted only, no market cap, and blocked here.

---

## 7. API keys still needed

| Variable | Provider | Needed for | Status |
|---|---|---|---|
| `TWELVEDATA_API_KEY` | Twelve Data | Activating the verified backup | **missing** |
| `FMP_API_KEY` | Financial Modeling Prep | Optional third source | missing |
| `ALPHAVANTAGE_API_KEY` | Alpha Vantage | Optional (25 req/day) | missing |
| `FINNHUB_API_KEY` | Finnhub | Optional live quotes | missing |
| `POLYGON_API_KEY` | Polygon.io | Optional (5 req/min) | missing |

Only the first one changes behaviour today: with it, a Yahoo outage degrades to a labelled backup
instead of an error state. Keys live in `.env` (git-ignored) and are read only by the Python
service — never bundled into the browser build.

---

## 8. Failure behaviour (verified)

Test: service started with `DATA_PROVIDER_CHAIN="stooq,yahoo"`, fresh cache.

* Stooq failed for the first symbols → circuit breaker opened after 3 consecutive hard failures →
  Yahoo served the remaining symbols.
* Payload: `is_backup: true`, `primary_unavailable: true`,
  `warnings: ["Primary provider Stooq is unavailable; serving Yahoo Finance.", "4 symbol(s) served by a backup provider: …"]`.
* UI: amber "Primary provider Stooq is unavailable; serving Yahoo Finance." banner, badge switches
  to the backup colour, every row keeps its real source label.

Test: data service stopped entirely.

* UI: red banner "The market data service is unreachable. No substitute data is shown.", every
  value replaced by `—`, charts replaced by "Waiting for verified price history…", donut centre
  shows `—`. No invented prices anywhere.

---

## 9. Re-running the tests

```bash
.venv-datatest/bin/python data-service/tests/provider_probe.py   # Phase 1–3 evidence
.venv-datatest/bin/python data-service/tests/verify.py           # Phase 8 checks (service must be up)
```

Both write JSON next to this file so the numbers can be re-checked rather than trusted.

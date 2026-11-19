/**
 * Live "what would today's signal buy" weights.
 *
 * The Holdings table publishes the weights frozen at the last rebalance. The
 * Live Momentum table describes a *hypothetical* book rebuilt from today's
 * ranking, so borrowing the frozen weights there would show a 12–1 momentum
 * score from today next to a size from up to six months ago.
 *
 * This module re-runs the published sizing rule over the live signal rows:
 *
 *     raw = score x sqrt(float market cap / median float market cap)
 *
 * then constrains the book to the same limits the server enforces (≤ 9% per
 * name, ≤ 35% per sector group) by bisection on a common scale factor.
 *
 * The mirror source is `data-service/app/portfolio.py`
 * (`raw_weights`, `_apply_caps`, `SECTOR_GROUPS`). Change one, change the other;
 * `tests/portfolio-live-weights.test.mjs` reads the Python file so the sector
 * grouping cannot drift silently.
 *
 * Nothing here invents data: a row without a verified score or float cap is not
 * investable, so it is not part of the simulated book at all.
 */

export const LIVE_WEIGHT_RULE = Object.freeze({
  // β = 0.5 is the official production exponent; it is not user-configurable.
  marketCapExponent: 0.5,
  singleNameCap: 9,
  sectorCap: 35,
  // The server bisects to this total-weight tolerance, so the simulated book
  // agrees with a real rebalance to well below the displayed tenth of a percent.
  totalTolerance: 1e-6,
});

/** Canonical constraint groups — mirrored from portfolio.py's SECTOR_GROUPS. */
export const LIVE_SECTOR_GROUPS = Object.freeze({
  Technology: "Technology",
  Communication: "Communication",
  Healthcare: "Healthcare",
  "Consumer Discretionary": "Consumer",
  "Consumer Staples": "Consumer",
  Industrials: "Industrials",
  Financials: "Others",
  Energy: "Others",
  Materials: "Others",
  Utilities: "Others",
  "Real Estate": "Others",
  // Group names map to themselves so the mapping is idempotent.
  Consumer: "Consumer",
  Others: "Others",
  Other: "Others",
});

/** One sector name → its 35%-cap group. Unknown sectors land in "Others". */
export function liveSectorGroup(value) {
  return LIVE_SECTOR_GROUPS[String(value ?? "").trim()] ?? "Others";
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A signal row can be sized only when it has a positive score and a positive
 * float-adjusted market cap — the same two conditions the server uses.
 */
export function isInvestableSignal(row) {
  return finite(row?.score) && row.score > 0
    && finite(row?.floatMarketCap) && row.floatMarketCap > 0;
}

/**
 * The book today's ranking would buy: the top `targetHoldings` investable rows,
 * in signal (rank) order. Non-investable rows are skipped rather than
 * substituted, exactly like `rank_for_selection` does on the server.
 */
export function selectLiveBook(rows, targetHoldings) {
  const source = Array.isArray(rows) ? rows : [];
  const limit = finite(targetHoldings) ? Math.floor(targetHoldings) : 0;
  if (limit <= 0) return [];
  const book = [];
  for (const row of source) {
    if (!isInvestableSignal(row)) continue;
    book.push(row);
    if (book.length === limit) break;
  }
  return book;
}

function medianOf(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function totalOf(weights) {
  let total = 0;
  for (const weight of weights.values()) total += weight;
  return total;
}

/**
 * `min(cap, λ · raw)` per name, with any sector group above its cap scaled back
 * inside that group. Total invested capital is monotonic in λ, so the caller can
 * bisect for the fully invested book.
 */
function allocate(scale, raw, sectors) {
  const weights = new Map();
  for (const [ticker, weight] of raw) {
    weights.set(ticker, Math.min(LIVE_WEIGHT_RULE.singleNameCap, Math.max(0, weight * scale)));
  }
  const groupTotals = new Map();
  for (const [ticker, weight] of weights) {
    const group = sectors.get(ticker);
    groupTotals.set(group, (groupTotals.get(group) ?? 0) + weight);
  }
  for (const [ticker, weight] of weights) {
    const group = sectors.get(ticker);
    const groupTotal = groupTotals.get(group);
    if (groupTotal > LIVE_WEIGHT_RULE.sectorCap + 1e-12) {
      weights.set(ticker, weight * (LIVE_WEIGHT_RULE.sectorCap / groupTotal));
    }
  }
  return weights;
}

/**
 * Simulated target weights for one live book.
 *
 * Returns `null` when the book cannot be sized honestly — no usable float caps,
 * too few names or groups to reach 100% inside the caps, or a solver that fails
 * to converge. Callers must render an em dash rather than a guessed number.
 */
export function simulateLiveWeights(book) {
  const rows = (Array.isArray(book) ? book : []).filter(isInvestableSignal);
  if (!rows.length) return null;

  const medianFloatMarketCap = medianOf(rows.map((row) => row.floatMarketCap));
  if (!(medianFloatMarketCap > 0)) return null;

  const exponent = LIVE_WEIGHT_RULE.marketCapExponent;
  const raw = new Map();
  for (const row of rows) {
    raw.set(
      row.ticker,
      row.score * (row.floatMarketCap / medianFloatMarketCap) ** exponent,
    );
  }
  const rawTotal = totalOf(raw);
  if (!(rawTotal > 0)) return null;

  const normalized = new Map();
  for (const [ticker, weight] of raw) normalized.set(ticker, (weight / rawTotal) * 100);

  const sectors = new Map(rows.map((row) => [row.ticker, liveSectorGroup(row.sector)]));

  // The two feasibility pre-checks the server makes before solving, so an
  // impossible book reports "no weight" instead of a partial allocation.
  if (normalized.size * LIVE_WEIGHT_RULE.singleNameCap + 1e-9 < 100) return null;
  if (new Set(sectors.values()).size * LIVE_WEIGHT_RULE.sectorCap + 1e-9 < 100) return null;

  let low = 0;
  let high = 1;
  while (totalOf(allocate(high, normalized, sectors)) < 100 && high < 1e9) high *= 2;
  if (totalOf(allocate(high, normalized, sectors)) + 1e-7 < 100) return null;

  for (let step = 0; step < 120; step += 1) {
    const middle = (low + high) / 2;
    if (totalOf(allocate(middle, normalized, sectors)) < 100) low = middle;
    else high = middle;
  }

  const weights = allocate((low + high) / 2, normalized, sectors);
  const totalWeight = totalOf(weights);
  if (Math.abs(totalWeight - 100) > LIVE_WEIGHT_RULE.totalTolerance) return null;

  const groupTotals = new Map();
  let maximumHoldingWeight = 0;
  for (const [ticker, weight] of weights) {
    if (weight > LIVE_WEIGHT_RULE.singleNameCap + 1e-7) return null;
    maximumHoldingWeight = Math.max(maximumHoldingWeight, weight);
    const group = sectors.get(ticker);
    groupTotals.set(group, (groupTotals.get(group) ?? 0) + weight);
  }
  const maximumSectorWeight = Math.max(...groupTotals.values());
  if (maximumSectorWeight > LIVE_WEIGHT_RULE.sectorCap + 1e-7) return null;

  return {
    weights,
    medianFloatMarketCap,
    totalWeight,
    maximumHoldingWeight,
    maximumSectorWeight,
  };
}

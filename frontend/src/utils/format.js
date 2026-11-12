/**
 * Shared display formatting.
 *
 * Both the Screener table and the Stock Analysis price summary read the same
 * numeric `marketCap` field from the provider, so they must format it the
 * same way: one function, one output.
 */

/**
 * Compact USD market-cap notation.
 *
 *   3_000_000_000_000 → $3.00T
 *     850_400_000_000 → $850.4B
 *      42_600_000_000 → $42.6B
 *         950_000_000 → $950M
 *
 * Missing or invalid values render as "—" rather than as a fake number.
 */
export function formatMarketCap(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${Math.round(value / 1e6)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

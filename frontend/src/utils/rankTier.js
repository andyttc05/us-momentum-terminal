/**
 * Ranking tier for the Stock Analysis rank badge.
 *
 * The tier comes from the stock's percentile position inside the eligible
 * universe — the same universe and the same ranks the Screener shows — so a
 * strong ranking reads green, a middling one yellow and a weak one red.
 */
export function getRankTier(rank, universeSize) {
  if (!Number.isFinite(rank) || !Number.isFinite(universeSize) || universeSize <= 0 || rank < 1) {
    return "unknown";
  }
  const percentile = rank / universeSize;
  if (percentile <= 0.2) return "top";
  if (percentile <= 0.8) return "mid";
  return "low";
}

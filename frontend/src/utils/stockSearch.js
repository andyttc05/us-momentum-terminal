const normalize = (value) => String(value ?? "")
  .trim()
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

/**
 * Return a match priority or null. Lower numbers are more relevant:
 * exact ticker, ticker prefix, ticker substring, company prefix,
 * company word-prefix, then a guarded company substring.
 */
export function searchMatch(stock, rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return 0;
  const ticker = normalize(stock?.ticker);
  const company = normalize(
    String(stock?.company ?? "").replace(/([a-z])([A-Z])/g, "$1 $2"),
  );
  if (ticker === query) return 0;
  if (ticker.startsWith(query)) return 1;
  if (ticker.includes(query)) return 2;
  if (company.startsWith(query)) return 3;
  if (company.split(" ").some((word) => word.startsWith(query))) return 4;

  // One- and two-character substring matching creates noise inside ordinary
  // words ("nv" in "Investment"). Requiring three characters retains useful
  // discoverability without flooding short searches with unrelated companies.
  if (query.length >= 3 && company.includes(query)) return 5;
  return null;
}

export function compareSearchMatches(left, right) {
  const priority = left.searchPriority - right.searchPriority;
  if (priority) return priority;
  return left.stock.rank - right.stock.rank;
}

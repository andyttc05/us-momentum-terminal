/** Small, dependency-free guards for the static publication hand-off. */
export function publicationIdentity(payload) {
  const meta = payload?.meta ?? {};
  const snapshot = meta.staticSnapshot ?? {};
  return {
    version: snapshot.publicationVersion ?? meta.publication_version ?? "",
    generatedAt: snapshot.generatedAt ?? meta.generated_at ?? "",
    asOf: snapshot.asOf ?? meta.as_of ?? "",
  };
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validManifest(manifest) {
  return Boolean(
    manifest
    && Number.isInteger(manifest.schemaVersion)
    && manifest.schemaVersion >= 2
    && typeof manifest.publicationVersion === "string"
    && manifest.publicationVersion
    && typeof manifest.generatedAt === "string"
    && manifest.generatedAt
      && validTimestamp(manifest.generatedAt)
    && typeof manifest.asOf === "string"
    && manifest.asOf
      && validDate(manifest.asOf)
    && Number.isInteger(manifest.stockCount)
    && manifest.stockCount > 0,
  );
}

/**
 * A browser cache is the last-known-good copy, so only a complete publication
 * with consistent universe accounting may ever enter or replace it. Eligible
 * stock counts can be below the requested universe; provider omissions cannot.
 */
export function validPublication(payload) {
  if (!payload || typeof payload !== "object") return false;
  const meta = payload.meta ?? {};
  const identity = publicationIdentity(payload);
  const stocks = payload.stocks;
  const universe = payload.universe ?? {};
  const portfolios = payload.portfolios ?? {};
  const backtests = payload.backtest ?? {};
  if (!identity.version || !validTimestamp(identity.generatedAt) || !validDate(identity.asOf)) return false;
  if (meta.connection_status !== "connected") return false;
  if (!Array.isArray(stocks) || stocks.length === 0) return false;
  const tickers = stocks.map((stock) => String(stock?.ticker ?? "").toUpperCase());
  if (tickers.some((ticker) => !ticker) || new Set(tickers).size !== tickers.length) return false;
  if (
    !Number.isInteger(universe.requested)
    || universe.requested <= 0
    || !Number.isInteger(universe.loaded)
    || universe.loaded !== universe.requested
    || universe.partial !== false
    || (Array.isArray(universe.unavailable) && universe.unavailable.length > 0)
  ) {
    return false;
  }
  for (const portfolio of ["top100", "top20"]) {
    if (!portfolios[portfolio]?.available) return false;
    if (!backtests[portfolio]?.available) return false;
  }
  return true;
}

export function publicationMatchesManifest(payload, manifest) {
  if (!validManifest(manifest) || !validPublication(payload)) return false;
  const identity = publicationIdentity(payload);
  return identity.version === manifest.publicationVersion
    && identity.generatedAt === manifest.generatedAt
    && identity.asOf === manifest.asOf
    && payload.stocks.length === manifest.stockCount;
}

export function isNewerPublication(next, current) {
  const nextIdentity = publicationIdentity(next);
  const currentIdentity = publicationIdentity(current);
  if (nextIdentity.version !== currentIdentity.version) return true;
  const nextTime = Date.parse(nextIdentity.generatedAt);
  const currentTime = Date.parse(currentIdentity.generatedAt);
  return Number.isFinite(nextTime) && (!Number.isFinite(currentTime) || nextTime > currentTime);
}

export function publicationAge(generatedAt, now = Date.now()) {
  const generated = Date.parse(generatedAt ?? "");
  if (!Number.isFinite(generated)) return null;
  return Math.max(0, now - generated);
}

/** A weekday schedule should leave no publication older than three days. */
export function isPublicationStale(generatedAt, now = Date.now(), staleAfterMs = 72 * 60 * 60 * 1000) {
  const age = publicationAge(generatedAt, now);
  return age !== null && age > staleAfterMs;
}

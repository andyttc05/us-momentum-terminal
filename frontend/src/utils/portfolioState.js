const REASON_TEXT = {
  "no verified float-adjusted market caps": "Verified float-share fundamentals are unavailable.",
  "no verified Momentum Scores": "Verified Momentum Scores are unavailable.",
  "float-adjusted market cap and score produced no positive raw weights": "Portfolio weights could not be calculated from verified inputs.",
  "too few holdings to reach 100% under the 9% stock cap": "There are too few eligible holdings to construct a fully invested portfolio.",
  "too few sectors to reach 100% under the 35% sector cap": "There are too few eligible sectors to satisfy the portfolio constraints.",
};

export function getPortfolioState({
  portfolio,
  status,
  meta,
  error,
  targetHoldings = 100,
}) {
  const holdings = portfolio?.holdings ?? [];
  if (portfolio?.available && holdings.length) {
    const cachedFundamentals = portfolio.fundamentals?.state === "cached";
    const cachedSnapshot = meta?.cache_state === "cached";
    const fallbackCount = portfolio.fundamentals?.fallbackCount ?? holdings.length;
    return cachedFundamentals || cachedSnapshot
      ? {
        kind: "cached",
        title: cachedFundamentals
          ? "Portfolio loaded from verified cached fundamentals"
          : "Portfolio loaded from verified cached data",
        detail: cachedFundamentals
          ? `${fallbackCount} ${fallbackCount === 1 ? "holding" : "holdings"} reused recent cached float-share metadata.`
          : "A background refresh is updating the publication.",
      }
      : { kind: "ready", title: "Portfolio loaded", detail: "Portfolio data is current." };
  }

  const warming = (
    status === "loading"
    || meta?.cache_state === "warming"
    || meta?.refresh_in_progress
  );
  if (warming) {
    return {
      kind: "loading",
      title: "Loading portfolio…",
      detail: "Waiting for verified rankings and float-share fundamentals.",
    };
  }

  if (!portfolio) {
    const failed = status === "error" || Boolean(error);
    return {
      kind: failed ? "error" : "unavailable",
      title: "Portfolio unavailable",
      detail: failed
        ? "No valid cached portfolio is available. Retry the market data update."
        : "The provider has not published a portfolio yet.",
    };
  }

  const rawReason = portfolio.reason ?? "";
  const infeasible = (
    portfolio.status === "infeasible"
    || rawReason.startsWith("too few holdings")
    || rawReason.includes("cap constraints cannot reach")
    || rawReason.includes("constraint solver")
  );
  if (infeasible) {
    return {
      kind: "infeasible",
      title: "Portfolio infeasible",
      detail: rawReason.startsWith("too few holdings")
        ? `Fewer than ${targetHoldings} eligible holdings have complete verified fundamentals.`
        : REASON_TEXT[rawReason] ?? (rawReason || "The portfolio constraints cannot be satisfied together."),
    };
  }
  const detail = rawReason.startsWith("too few holdings")
    ? `Fewer than ${targetHoldings} eligible holdings have complete verified fundamentals.`
    : REASON_TEXT[rawReason] ?? (error?.message || rawReason || "The service could not construct a valid portfolio.");
  return {
    kind: "unavailable",
    title: "Portfolio unavailable",
    detail,
  };
}


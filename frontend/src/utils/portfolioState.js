const REASON_TEXT = {
  "no verified float-adjusted market caps": "Verified float-share fundamentals are unavailable.",
  "no verified Momentum Scores": "Verified Momentum Scores are unavailable.",
  "float-adjusted market cap and score produced no positive raw weights": "Portfolio weights could not be calculated from verified inputs.",
  "too few holdings to reach 100% under the 9% stock cap": "There are too few eligible holdings to construct a fully invested portfolio.",
  "too few sectors to reach 100% under the 35% sector cap": "There are too few eligible sectors to satisfy the portfolio constraints.",
};

export function getPortfolioState({ portfolio, status, meta, error }) {
  const holdings = portfolio?.holdings ?? [];
  if (portfolio?.available && holdings.length) {
    const cached = portfolio.fundamentals?.state === "cached";
    const fallbackCount = portfolio.fundamentals?.fallbackCount ?? holdings.length;
    return cached
      ? {
        kind: "cached",
        title: "Portfolio loaded from verified cached fundamentals",
        detail: `${fallbackCount} ${fallbackCount === 1 ? "holding" : "holdings"} reused recent cached float-share metadata.`,
      }
      : { kind: "ready", title: "Portfolio loaded", detail: "Portfolio data is current." };
  }

  const warming = (
    status === "loading"
    || meta?.cache_state === "warming"
    || meta?.refresh_in_progress
  );
  if (!portfolio || warming) {
    return {
      kind: "loading",
      title: "Loading portfolio…",
      detail: "Waiting for verified rankings and float-share fundamentals.",
    };
  }

  const rawReason = portfolio.reason ?? "";
  const detail = rawReason.startsWith("too few holdings")
    ? "Fewer than 100 eligible holdings have complete verified fundamentals."
    : REASON_TEXT[rawReason] ?? (error?.message || rawReason || "The service could not construct a valid portfolio.");
  return {
    kind: "unavailable",
    title: "Portfolio unavailable",
    detail,
  };
}


export const DEFAULT_REBALANCE_FREQUENCY = "semiannual";

export const REBALANCE_OPTIONS = [
  { value: "monthly", label: "Monthly (Every Month)", summary: "Monthly" },
  { value: "quarterly", label: "Quarterly (Mar / Jun / Sep / Dec)", summary: "Quarterly" },
  { value: "semiannual", label: "Semiannual (Mar / Sep)", summary: "Semiannual" },
  { value: "annual", label: "Annual (September)", summary: "Annual" },
];

export function isRebalanceFrequency(value) {
  return REBALANCE_OPTIONS.some((option) => option.value === value);
}

export function rebalanceOption(value) {
  return REBALANCE_OPTIONS.find((option) => option.value === value)
    ?? REBALANCE_OPTIONS.find((option) => option.value === DEFAULT_REBALANCE_FREQUENCY);
}

export function rebalanceLabel(value) {
  return rebalanceOption(value).label;
}

export function rebalanceSummaryLabel(value) {
  return rebalanceOption(value).summary;
}

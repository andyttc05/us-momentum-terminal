export const DEFAULT_REBALANCE_FREQUENCY = "semiannual";

export const REBALANCE_OPTIONS = [
  {
    value: "monthly",
    label: "Monthly (Every Month)",
    summary: "Monthly",
    signalMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  {
    value: "quarterly",
    label: "Quarterly (Mar / Jun / Sep / Dec)",
    summary: "Quarterly",
    signalMonths: [3, 6, 9, 12],
  },
  {
    value: "semiannual",
    label: "Semiannual (Mar / Sep)",
    summary: "Semiannual",
    signalMonths: [3, 9],
  },
  {
    value: "annual",
    label: "Annual (September)",
    summary: "Annual",
    signalMonths: [9],
  },
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

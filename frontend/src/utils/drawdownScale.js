const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Build a zero-anchored drawdown axis with five to six readable labels.
 * Small drawdowns use 10-point intervals; larger ranges choose a rounded step.
 */
export function buildDrawdownScale(values) {
  const finite = (values ?? []).filter((value) => Number.isFinite(value));
  const actualMin = Math.min(0, ...finite);
  const range = Math.abs(actualMin);
  if (range === 0) return { min: 0, actualMin: 0, step: 10, ticks: [0] };

  let step;
  if (range <= 60) {
    step = 10;
  } else {
    const desired = range / 5;
    const magnitude = 10 ** Math.floor(Math.log10(desired));
    const normalized = desired / magnitude;
    step = (NICE_STEPS.find((candidate) => candidate >= normalized) ?? 10) * magnitude;
  }

  const min = -Math.ceil(range / step) * step;
  const ticks = [];
  for (let value = 0; value >= min - 1e-9; value -= step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return { min, actualMin, step, ticks };
}

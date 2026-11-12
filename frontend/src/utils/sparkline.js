export function momentumSparklineValues(stock) {
  const values = stock?.sparkline12_1?.values;
  if (!Array.isArray(values) || values.length < 2) return [];
  return values.every((value) => Number.isFinite(value)) ? values : [];
}

export function momentumSparklineDomain(stocks) {
  const values = stocks.flatMap(momentumSparklineValues);
  if (!values.length) return { min: 0, max: 100 };
  const low = Math.min(100, ...values);
  const high = Math.max(100, ...values);
  const padding = Math.max(4, (high - low) * 0.05);
  return {
    min: Math.floor((low - padding) / 10) * 10,
    max: Math.ceil((high + padding) / 10) * 10,
  };
}

export function momentumSparklinePoints(values, domain) {
  if (!values.length) return "";
  const min = Number.isFinite(domain?.min) ? domain.min : Math.min(...values);
  const max = Number.isFinite(domain?.max) ? domain.max : Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const bounded = Math.min(max, Math.max(min, value));
      const y = 23 - ((bounded - min) / span) * 19;
      return `${x},${y}`;
    })
    .join(" ");
}

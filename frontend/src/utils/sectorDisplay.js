export const SECTOR_GROUP_LIMIT = 6;

/**
 * Build the presentation-only Top 6 + Other grouping. The source objects and
 * values remain untouched while all remaining sectors are summed into Other.
 */
export function getSectorAllocationGroups(sectors = [], limit = SECTOR_GROUP_LIMIT) {
  const ranked = sectors
    .filter((sector) => Number.isFinite(Number(sector.value)) && Number(sector.value) > 0)
    .sort((left, right) => Number(right.value) - Number(left.value));
  const top = ranked.slice(0, limit);
  const topNames = new Set(top.map(({ name }) => name));
  const members = sectors.filter(({ name }) => !topNames.has(name));
  const otherValue = Math.round(
    members.reduce((total, sector) => total + (Number.isFinite(Number(sector.value)) ? Number(sector.value) : 0), 0) * 100,
  ) / 100;

  return {
    groups: otherValue > 0
      ? [...top, { name: "Other", value: otherValue, color: "var(--color-sector-other)" }]
      : top,
  };
}

export function formatSectorPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric}%`;
}

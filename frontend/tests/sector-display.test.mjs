import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_SECTOR_LIMIT, formatSectorPercent, getSectorAllocationGroups } from "../src/utils/sectorDisplay.js";

test("sector display keeps the six largest positive sectors and aggregates the rest", () => {
  const source = [
    { name: "Industrials", value: 4 },
    { name: "Technology", value: 35 },
    { name: "Utilities", value: 0 },
    { name: "Financials", value: 6 },
    { name: "Energy", value: 13 },
    { name: "Healthcare", value: 13 },
    { name: "Communication", value: 15 },
    { name: "Consumer Staples", value: 10 },
    { name: "Materials", value: 2 },
    { name: "Real Estate", value: 2 },
  ];
  const { groups } = getSectorAllocationGroups(source);
  assert.deepEqual(
    groups.map(({ name }) => name),
    ["Technology", "Communication", "Energy", "Healthcare", "Consumer Staples", "Financials", "Other"],
  );
  const other = groups.at(-1);
  assert.equal(other.value, 8);
  assert.equal("members" in other, false);
  assert.equal(groups.reduce((total, sector) => total + sector.value, 0), 100);
  assert.deepEqual(
    source.map(({ name }) => name),
    ["Industrials", "Technology", "Utilities", "Financials", "Energy", "Healthcare", "Communication", "Consumer Staples", "Materials", "Real Estate"],
  );
});

test("sector display avoids an empty Other group", () => {
  const { groups } = getSectorAllocationGroups([
    { name: "Technology", value: 60 },
    { name: "Energy", value: 40 },
  ]);
  assert.deepEqual(groups.map(({ name }) => name), ["Technology", "Energy"]);
});

test("phone grouping names five sectors and keeps the total unchanged", () => {
  const source = [
    { name: "Technology", value: 35 },
    { name: "Communication", value: 14 },
    { name: "Energy", value: 12.5 },
    { name: "Healthcare", value: 12.4 },
    { name: "Consumer Staples", value: 11.1 },
    { name: "Financials", value: 8.1 },
    { name: "Other", value: 6.9 },
  ];
  const { groups } = getSectorAllocationGroups(source, MOBILE_SECTOR_LIMIT);
  assert.equal(MOBILE_SECTOR_LIMIT, 5);
  assert.deepEqual(
    groups.map(({ name }) => name),
    ["Technology", "Communication", "Energy", "Healthcare", "Consumer Staples", "Other"],
  );
  // The desktop grouping still names six sectors; only the phone view aggregates.
  assert.equal(getSectorAllocationGroups(source).groups.length, 7);
  // Presentation only: the aggregated total is identical to the source total.
  assert.equal(
    Math.round(groups.reduce((total, sector) => total + sector.value, 0) * 100) / 100,
    100,
  );
  assert.deepEqual(source.map(({ value }) => value), [35, 14, 12.5, 12.4, 11.1, 8.1, 6.9]);
});

test("sector percentages preserve the precision supplied by the data service", () => {
  assert.equal(formatSectorPercent(35), "35%");
  assert.equal(formatSectorPercent(14.8), "14.8%");
  assert.equal(formatSectorPercent(0.4), "0.4%");
  assert.equal(formatSectorPercent(12.345), "12.345%");
});

import assert from "node:assert/strict";
import test from "node:test";
import { formatSectorPercent, getSectorAllocationGroups } from "../src/utils/sectorDisplay.js";

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

test("sector percentages preserve the precision supplied by the data service", () => {
  assert.equal(formatSectorPercent(35), "35%");
  assert.equal(formatSectorPercent(14.8), "14.8%");
  assert.equal(formatSectorPercent(0.4), "0.4%");
  assert.equal(formatSectorPercent(12.345), "12.345%");
});

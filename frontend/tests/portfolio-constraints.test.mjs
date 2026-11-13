import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  evaluatePortfolioConstraints,
  PORTFOLIO_CONSTRAINT_DEFINITIONS,
} from "../src/utils/portfolioConstraints.js";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const portfolioPage = source("../src/PortfolioPage.jsx");
const portfolioCss = source("../src/styles/portfolio.css");

function holdings({ count = 100, sectorFor = () => "Technology", weightFor = () => 1 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    ticker: `T${index + 1}`,
    sector: sectorFor(index),
    finalWeight: weightFor(index),
  }));
}

test("constraint display contract has exactly the four approved rules in order", () => {
  assert.deepEqual(
    PORTFOLIO_CONSTRAINT_DEFINITIONS.map(({ label, rule }) => `${label} ${rule}`),
    [
      "Max Stock Weight ≤ 9%",
      "Max Sector Weight ≤ 35%",
      "Target Holdings = 100",
      "Target Allocation = 100%",
    ],
  );
});

test("a valid fully weighted book passes all four constraints", () => {
  const result = evaluatePortfolioConstraints(holdings({
    sectorFor: (index) => index % 4 === 0 ? "Technology" : ["Energy", "Healthcare", "Financials"][index % 3],
  }));
  assert.equal(result.evaluated, true);
  assert.equal(result.constraints.length, 4);
  assert.deepEqual(result.constraints.map(({ status }) => status), Array(4).fill("passed"));
  assert.equal(result.validation.totalFinalWeight, 100);
});

test("Top 20 recomputes the target-holdings rule from the selected universe", () => {
  const result = evaluatePortfolioConstraints(holdings({
    count: 20,
    sectorFor: (index) => ["Technology", "Energy", "Healthcare", "Financials"][index % 4],
    weightFor: () => 5,
  }), 20);
  assert.deepEqual(
    result.constraints.map(({ label, rule, status }) => `${label} ${rule}: ${status}`),
    [
      "Max Stock Weight ≤ 9%: passed",
      "Max Sector Weight ≤ 35%: passed",
      "Target Holdings = 20: passed",
      "Target Allocation = 100%: passed",
    ],
  );
});

test("stock, sector, holdings and allocation failures are independently reported", () => {
  const stockFailure = evaluatePortfolioConstraints(holdings({
    weightFor: (index) => index === 0 ? 9.1 : 91 / 99,
  }));
  assert.equal(stockFailure.constraints.find(({ id }) => id === "max-stock").status, "failed");

  const sectorFailure = evaluatePortfolioConstraints(holdings({
    sectorFor: (index) => index < 36 ? "Technology" : "Energy",
  }));
  assert.equal(sectorFailure.constraints.find(({ id }) => id === "max-sector").status, "failed");

  const holdingsFailure = evaluatePortfolioConstraints(holdings({ count: 99 }));
  assert.equal(holdingsFailure.constraints.find(({ id }) => id === "target-holdings").status, "failed");
  assert.equal(holdingsFailure.constraints.find(({ id }) => id === "target-allocation").status, "failed");

  const allocationFailure = evaluatePortfolioConstraints(holdings({
    weightFor: () => 0.5,
  }));
  assert.equal(allocationFailure.constraints.find(({ id }) => id === "target-allocation").status, "failed");
});

test("missing or invalid weights never produce a green check", () => {
  const rows = holdings();
  rows[17].finalWeight = null;
  const result = evaluatePortfolioConstraints(rows);
  assert.equal(result.evaluated, false);
  assert.deepEqual(result.constraints.map(({ status }) => status), Array(4).fill("unavailable"));
});

test("the Largest Holding KPI shows only the ticker while retaining its weight in the data", () => {
  assert.match(
    portfolioPage,
    /label="Largest Holding" value=\{portfolioSummary\?\.largestHolding\?\.ticker \?\? pendingKpi\}/,
  );
  assert.doesNotMatch(
    portfolioPage,
    /largestHolding\?\.ticker[\s\S]{0,80}displayPercent\(portfolioSummary\?\.largestHolding\?\.finalWeight\)/,
  );
  assert.match(portfolioPage, /holding\.finalWeight/);
  assert.match(portfolioPage, /portfolioSummary\?\.largestHolding\?\.ticker/);
});

test("constraint rows use the recomputed statuses and one equal-height visual contract", () => {
  assert.match(portfolioPage, /evaluatePortfolioConstraints\(portfolioHoldings, targetHoldings\)/);
  assert.match(portfolioPage, /constraintEvaluation\.constraints\.map/);
  assert.doesNotMatch(portfolioPage, /portfolioConstraints\.map/);
  assert.match(
    portfolioCss,
    /\.portfolio-constraint \{[^}]*height: 37px;[^}]*grid-template-columns: 25px minmax\(0, 1fr\) auto 25px;[^}]*align-items: center;/s,
  );
  assert.equal((portfolioPage.match(/<LeadingIcon\b/g) ?? []).length, 1);
  assert.match(portfolioPage, /constraintIcons = \{[\s\S]*"max-stock": Stack,[\s\S]*"max-sector": ShareNetwork,[\s\S]*"target-holdings": ChartBar,[\s\S]*"target-allocation": Target,/);
  assert.match(portfolioCss, /\.portfolio-constraint strong \{[^}]*text-align: right;/s);
  assert.match(portfolioCss, /\.portfolio-constraint\.is-unavailable > svg \{ color: var\(--color-warning\); \}/);
});

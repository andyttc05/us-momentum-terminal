import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);
const sectionStart = page.indexOf('<section className="backtest-kpis"');
const sectionEnd = page.indexOf("</section>", sectionStart);
const kpiSection = page.slice(sectionStart, sectionEnd);

test("the backtest summary has exactly four KPI cards in the required order", () => {
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const labels = [...kpiSection.matchAll(/<KpiCard\b[\s\S]*?label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Start Balance", "End Balance", "CAGR", "Total Return"]);
  assert.equal((kpiSection.match(/<KpiCard\b/g) ?? []).length, 4);
});

test("balance cards use actual report values and keep loading and empty states", () => {
  assert.match(kpiSection, /label="Start Balance"[\s\S]*?value=\{report \? formatMoney\(report\.initialCapital\) : "—"\}/);
  assert.match(kpiSection, /label="End Balance"[\s\S]*?value=\{report \? formatMoney\(report\.finalValue\) : "—"\}/);
  assert.equal((kpiSection.match(/loading=\{resultsLoading\}/g) ?? []).length, 4);
  assert.doesNotMatch(kpiSection, /value="\$[\d,]+"/);
});

test("performance cards retain the validated metrics and obsolete cards are gone", () => {
  assert.match(kpiSection, /label="CAGR"[\s\S]*?value=\{formatPercent\(metrics\.cagr\)\}/);
  assert.match(kpiSection, /label="Total Return"[\s\S]*?value=\{formatPercent\(metrics\.totalReturn\)\}/);
  assert.doesNotMatch(kpiSection, /Profit \/ Loss|Sharpe Ratio/);
});

test("monetary balances stay neutral while performance figures keep their tone", () => {
  const startCard = kpiSection.slice(
    kpiSection.indexOf('label="Start Balance"'),
    kpiSection.indexOf("<KpiCard", kpiSection.indexOf('label="Start Balance"')),
  );
  const endCard = kpiSection.slice(
    kpiSection.indexOf('label="End Balance"'),
    kpiSection.indexOf("<KpiCard", kpiSection.indexOf('label="End Balance"')),
  );
  assert.doesNotMatch(startCard, /valueTone=/);
  assert.doesNotMatch(endCard, /valueTone=/);
  assert.match(kpiSection, /label="CAGR"[\s\S]*?valueTone=\{valueTone\(metrics\.cagr\)\}/);
  assert.match(kpiSection, /label="Total Return"[\s\S]*?valueTone=\{valueTone\(metrics\.totalReturn\)\}/);
});

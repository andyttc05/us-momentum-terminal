import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  fileURLToPath(new URL("../src/StockAnalysisPage.jsx", import.meta.url)),
  "utf8",
);
const styles = readFileSync(
  fileURLToPath(new URL("../src/styles/stock-analysis.css", import.meta.url)),
  "utf8",
);

/** The price summary section, so assertions cannot match the rest of the page. */
function summarySection() {
  const start = page.indexOf('<section className="stock-price-summary"');
  const end = page.indexOf("</section>", start);
  return page.slice(start, end);
}

test("market cap and rank share one icon + label + value rhythm", () => {
  const summary = summarySection();
  assert.ok(summary.length > 0, "the price summary must exist");

  // Both blocks start with an icon at the same size, then the copy column.
  assert.match(summary, /<Stack size=\{24\} weight="regular" aria-hidden="true" \/>/);
  assert.match(summary, /<Crown size=\{24\} weight="regular" aria-hidden="true" \/>/);

  // Rank used to be the only block without an icon, which made it read as an
  // afterthought beside market cap.
  for (const block of summary.split('<div className="stock-summary-block">').slice(1)) {
    assert.match(block, /svg|Crown|Stack/, "every summary block carries an icon");
  }
});

test("market cap and rank icons share the same ink colour", () => {
  // No per-icon colour class: the row reads as one unit, so the crown is ink
  // like the stack beside it instead of carrying its own gold.
  assert.doesNotMatch(styles, /stock-summary-block__rank-icon/);
  const summary = summarySection();
  assert.match(summary, /stock-summary-block__value--\$\{rankTier\}/);
});

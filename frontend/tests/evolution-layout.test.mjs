import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Layout contract for the Portfolio Evolution workspace.
 *
 * The history panel is the taller of the two cards, so it sets the shared grid
 * row height for the whole workspace. When its list was sized by the number of
 * events on the page, the final page (three events) shortened both cards by
 * 22px and pulled the holdings toolbar, table and pagination up with it. The
 * list therefore reserves a fixed number of slots instead of stretching the
 * rows it happens to contain.
 */

const styles = readFileSync(new URL("../src/styles/backtesting.css", import.meta.url), "utf8");

function rule(selector) {
  const start = styles.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} is missing from backtesting.css`);
  const end = styles.indexOf("\n}", start);
  return styles.slice(start, end);
}

test("the workspace stretches both cards to one shared row height", () => {
  assert.match(rule(".portfolio-evolution__workspace"), /align-items:\s*stretch;/);
});

test("the event list reserves five slots rather than sizing to its rows", () => {
  const list = rule(".portfolio-evolution__events");
  assert.match(list, /grid-template-rows:\s*repeat\(5,\s*minmax\(var\(--portfolio-event-row\),\s*auto\)\);/);
  // A fixed track list plus `align-content: start` is what keeps the empty
  // slots inert: they hold space but no row is stretched into them.
  assert.match(list, /align-content:\s*start;/);
  assert.match(list, /min-height:\s*0;/);
});

test("event rows and their loading skeletons share one row height", () => {
  assert.match(styles, /--portfolio-event-row:\s*78px;/);
  assert.match(rule(".portfolio-evolution__event"), /min-height:\s*var\(--portfolio-event-row\);/);
  assert.match(rule(".portfolio-evolution__event-skeleton"), /min-height:\s*var\(--portfolio-event-row\);/);
  // A row taller than its slot would push the list past five slots again.
  assert.doesNotMatch(styles, /\.portfolio-evolution__event \{[^}]*min-height:\s*\d+px;/s);
});

test("pagination stays anchored to the bottom of its card", () => {
  assert.match(
    styles,
    /\.portfolio-evolution__history-panel > \.table-pagination,\s*\.portfolio-evolution__holdings-panel > \.table-pagination \{\s*margin-top:\s*auto;/,
  );
});

test("stacked cards drop the reserved slots instead of forcing a desktop height", () => {
  const mobile = styles.slice(styles.indexOf("@media (max-width: 1240px)"));
  assert.match(mobile.slice(0, mobile.indexOf("\n}")), /\.portfolio-evolution__workspace \{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(mobile.slice(0, mobile.indexOf("\n}")), /\.portfolio-evolution__events \{\s*grid-template-rows:\s*none;/);
});

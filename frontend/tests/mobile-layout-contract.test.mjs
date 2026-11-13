// Guards the parts of the phone layouts that cannot be checked by rendering:
// the JavaScript breakpoints must match the stylesheet blocks, and the iOS-only
// declarations must stay where the WebKit layout actually reads them.
//
// Each of these assertions caught a real regression while the mobile tables,
// the toast and the date fields were being fixed, so they are kept as cheap
// tripwires for the next change.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PHONE_MEDIA_QUERY, PHONE_TABLE_MEDIA_QUERY } from "../src/utils/breakpoints.js";

const stylePath = (name) => fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url));
const read = (name) => readFileSync(stylePath(name), "utf8");

/** The declarations inside the first `@media (max-width: <px>px)` block. */
function phoneBlock(css, px) {
  const start = css.indexOf(`@media (max-width: ${px}px) {`);
  assert.notEqual(start, -1, `expected a @media (max-width: ${px}px) block`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced media block");
}

const px = (query) => Number(query.match(/max-width:\s*(\d+)px/)[1]);

test("the JavaScript phone breakpoints match the stylesheet breakpoints", () => {
  const tablePx = px(PHONE_TABLE_MEDIA_QUERY);
  assert.match(read("screener.css"), new RegExp(`@media \\(max-width: ${tablePx}px\\)`));
  assert.match(read("portfolio.css"), new RegExp(`@media \\(max-width: ${tablePx}px\\)`));
  assert.match(read("app.css"), new RegExp(`@media \\(max-width: ${px(PHONE_MEDIA_QUERY)}px\\)`));
});

test("the phone tables pin the ticker at the leading edge with no rank offset", () => {
  for (const [file, selector] of [
    ["screener.css", ".stock-ticker-cell"],
    ["portfolio.css", ".portfolio-ticker-cell"],
  ]) {
    const block = phoneBlock(read(file), px(PHONE_TABLE_MEDIA_QUERY));
    assert.match(block, new RegExp(selector), `${file} must style ${selector}`);
    assert.match(block, /position:\s*sticky/, `${file} must make the ticker sticky`);
    // `left: 0` exactly — a rank-column offset here would leave a gap on phones,
    // where the rank column is not rendered.
    assert.match(block, /left:\s*0;/, `${file} must pin the ticker at left: 0`);
    assert.doesNotMatch(block, /left:\s*var\(--rank-col-width\)/, `${file} must not offset by a rank column`);
    // Sticky cells need an opaque background or the scrolling columns show through.
    assert.match(block, /background:\s*var\(--color-surface\)/, `${file} must give the ticker an opaque background`);
    assert.doesNotMatch(block, /--rank-col-width/, `${file} must not reserve a rank column width on phones`);
  }
});

test("the phone tables keep their pagination outside the scrolling region", () => {
  // The pagination is a sibling of the scroll container in both pages; if it
  // ever moved inside, it would scroll sideways with the columns.
  const screener = readFileSync(fileURLToPath(new URL("../src/ScreenerPage.jsx", import.meta.url)), "utf8");
  const portfolio = readFileSync(fileURLToPath(new URL("../src/PortfolioPage.jsx", import.meta.url)), "utf8");
  for (const source of [screener, portfolio]) {
    const scrollClose = source.indexOf("</table>");
    const scrollEnd = source.indexOf("</div>", scrollClose);
    const pagination = source.indexOf("<Pagination");
    assert.ok(scrollEnd !== -1 && pagination > scrollEnd, "Pagination must render after the scroll container closes");
  }
});

test("the phone toast is viewport-centred and clears the bottom navigation", () => {
  const block = phoneBlock(read("app.css"), px(PHONE_MEDIA_QUERY));
  assert.match(block, /\.notification-toast\s*\{[^}]*left:\s*var\(--toast-inset-left\)/s);
  assert.match(block, /\.notification-toast\s*\{[^}]*right:\s*var\(--toast-inset-right\)/s);
  assert.match(block, /margin-inline:\s*auto/, "the pill is centred by its auto margins, not a transform");
  // The bottom offset is derived from the bar itself: a hardcoded value drifts
  // as soon as the navigation or the safe-area inset changes.
  assert.match(block, /--toast-edge-bottom:\s*calc\(var\(--mobile-nav-gap\) \+ var\(--mobile-nav-height\)/);
  assert.match(block, /--mobile-nav-gap:\s*max\(10px,\s*env\(safe-area-inset-bottom\)\)/);
});

test("the date fields centre through the host input, which is what WebKit reads", () => {
  const block = phoneBlock(read("backtesting.css"), 680);
  // Safari ignores text-align on ::-webkit-date-and-time-value and takes the
  // alignment from the input element. Centring only the pseudo-elements looks
  // correct in Chrome and every device emulator, and left-aligned on iPhone.
  assert.match(block, /\.backtest-date-input\s*\{[^}]*text-align:\s*center/s);
  assert.match(block, /::-webkit-date-and-time-value\s*\{\s*text-align:\s*center/, "Chromium still needs the pseudo-element");
  // Both fields must stay identical boxes.
  assert.match(block, /\.backtest-date-input\s*\{[^}]*height:\s*48px/s);
});

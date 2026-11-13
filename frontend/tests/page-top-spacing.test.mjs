// Guards the shared top-of-page rhythm. Every page renders `main.page > .page-header`
// so the eyebrow, title and first card start at the same y on every screen; a page
// may not restate that spacing, or it drifts out of alignment — which is exactly what
// the Backtesting page used to do with its own 14px top padding and a 91px header.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const stylesDir = fileURLToPath(new URL("../src/styles/", import.meta.url));
const read = (name) => readFileSync(`${stylesDir}${name}`, "utf8");

// layout.css owns the shared values; tokens.css declares them. Every other sheet
// belongs to a page or a component and must not restate them.
const pageSheets = readdirSync(stylesDir).filter((name) => name.endsWith(".css") && name !== "layout.css" && name !== "tokens.css");

/** Every `selector { body }` pair in a stylesheet. */
function rules(css) {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
}

const pageSelector = /\.(?:backtest|portfolio|screener|overview|stock)-page\s*(?:>|,|$)/;

test("no page overrides the shared top padding", () => {
  for (const name of pageSheets) {
    for (const { selector, body } of rules(read(name))) {
      if (!pageSelector.test(selector)) continue;
      assert.doesNotMatch(body, /padding-top/, `${name} must not set padding-top on a page container`);
    }
  }
  assert.match(read("layout.css"), /\.page \{[^}]*padding: var\(--page-padding-block-start\)/s);
});

test("no page overrides the shared page-header height", () => {
  for (const name of pageSheets) {
    for (const { selector, body } of rules(read(name))) {
      if (!/\.page-header/.test(selector)) continue;
      assert.doesNotMatch(body, /min-height/, `${name} must not restate .page-header min-height`);
    }
  }
  assert.match(read("layout.css"), /\.page-header \{[^}]*min-height: var\(--page-header-height\)/s);
});

test("the Backtesting header keeps the shared page-header gap", () => {
  const css = read("backtesting.css");
  // The page is a flex column whose gap already spaces its sections, so the
  // header tops that gap up to --page-header-gap instead of zeroing it.
  assert.match(
    css,
    /\.backtest-page > \.page-header \{[^}]*margin-bottom: max\(0px, calc\(var\(--page-header-gap\) - var\(--backtest-section-gap\)\)\)/s,
  );
  // ...and the gap between the sections themselves is untouched.
  assert.match(css, /\.backtest-page \{[^}]*gap: var\(--backtest-section-gap\)/s);
  assert.match(css, /--backtest-section-gap: 15px/);
});

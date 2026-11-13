import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const formsCss = source("../src/styles/forms.css");
const stylesIndex = source("../src/styles.css");
const tokensCss = source("../src/styles/tokens.css");
const screenerCss = source("../src/styles/screener.css");
const backtestingCss = source("../src/styles/backtesting.css");

/** Slice a `@media (...) { ... }` block out of a stylesheet. */
function mediaBlock(css, query) {
  const start = css.indexOf(query);
  assert.ok(start >= 0, `missing ${query}`);
  return css.slice(start);
}

/** The bare-control focus rule, sliced out of the shared layer. */
const focusBlock = formsCss.slice(formsCss.indexOf("/* Focus:"), formsCss.indexOf("/* Pill fields"));

test("hover and focus resolve to the same shared sunny-yellow ring", () => {
  assert.match(tokensCss, /--color-field-border-active:\s*#F5C542/);
  assert.match(tokensCss, /--field-ring-width:\s*2px/);
  assert.match(focusBlock, /border-color: var\(--color-field-border-active\)/);
  assert.match(focusBlock, /outline: var\(--field-ring-width\) solid var\(--color-field-border-active\)/);
  const hoverBlock = mediaBlock(formsCss, "@media (hover: hover) and (pointer: fine)");
  assert.match(hoverBlock, /border-color: var\(--color-field-border-active\)/);
  assert.match(hoverBlock, /outline: var\(--field-ring-width\) solid var\(--color-field-border-active\)/);
});

test("the ring adds no width to the box", () => {
  // A 2px border would grow any control whose height is content-driven, so the
  // ring has to be an outline: it is painted, never laid out.
  assert.doesNotMatch(formsCss, /border-width:/);
  const offsets = [...formsCss.matchAll(/outline-offset:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(offsets.length >= 3, "every ring must set an offset");
  for (const offset of offsets) {
    assert.equal(offset, "calc(-1 * var(--field-ring-width))");
  }
});

test("a pill's inner input never draws a second ring", () => {
  // The wrapper owns the edge; the inputs inside it are border-less.
  assert.match(formsCss, /\.backtest-date-control input:focus,\s*\.backtest-date-control input:hover \{\s*outline: none;/);
  // ...and the page rules that clear the outline for the other two pills must
  // survive, otherwise those inputs draw a rectangle inside the pill.
  assert.match(screenerCss, /\.screener-search input \{[^}]*outline: 0;/s);
  assert.match(backtestingCss, /\.backtest-amount-control input \{[^}]*outline: 0;/s);
  // Real fields must not clear it, or the ring silently disappears.
  assert.doesNotMatch(screenerCss, /\.screener-filter-field select, \.screener-filter-field input \{[^}]*outline: 0;/s);
});

test("field states never paint a glow", () => {
  // `box-shadow: none` (clearing the browser's default) is the only shadow the
  // shared field layer may declare.
  for (const [, value] of formsCss.matchAll(/box-shadow:\s*([^;]+)/g)) {
    assert.equal(value.trim(), "none");
  }
  assert.doesNotMatch(formsCss, /box-shadow:\s*0 0 0/);
});

test("the browser focus ring is replaced, not merely deleted", () => {
  assert.match(focusBlock, /outline: var\(--field-ring-width\) solid var\(--color-field-border-active\)/);
  assert.match(focusBlock, /outline-offset: calc\(-1 \* var\(--field-ring-width\)\)/);
  assert.match(focusBlock, /border-color: var\(--color-field-border-active\)/);
});

test("hover is limited to devices that can actually hover", () => {
  const hoverBlock = mediaBlock(formsCss, "@media (hover: hover) and (pointer: fine)");
  assert.match(hoverBlock, /input[^{]*:hover/);
  assert.match(hoverBlock, /select:where\(:hover:not\(:disabled\)\)/);
  // Nothing outside that media query may tint a field on hover.
  const beforeMedia = formsCss.slice(0, formsCss.indexOf("@media (hover: hover)"));
  assert.doesNotMatch(beforeMedia, /:hover[^,{]*\{[^}]*--color-field-border-active/);
});

test("a tap cannot leave the date field tinted", () => {
  // Touch devices match :hover after a tap; the resting edge is restored, and
  // the focus rule has to stay after this reset so an active field still tints.
  const touchBlock = mediaBlock(formsCss, "@media (hover: none)");
  assert.match(touchBlock, /\.backtest-date-control:hover \{[^}]*border-color: var\(--color-line\)/s);
  assert.ok(
    formsCss.indexOf("@media (hover: none)") < formsCss.indexOf("/* Focus: same yellow ring"),
    "the touch reset must precede the focus rules",
  );
});

test("disabled and invalid fields keep their own appearance", () => {
  assert.match(formsCss, /:focus:not\(:disabled\)/);
  assert.match(formsCss, /:hover:not\(:disabled\)/);
  assert.match(formsCss, /input:where\([^\n]*focus:not\(:disabled\):not\(\[aria-invalid="true"\]\)/);
  assert.match(formsCss, /input:where\([^\n]*hover:not\(:disabled\):not\(\[aria-invalid="true"\]\)/);
  assert.match(formsCss, /\.backtest-date-group\.is-invalid \.backtest-date-control \{\s*border-color: #D8848B;\s*outline: none;/);
});

test("pages no longer paint their own field focus glow", () => {
  assert.doesNotMatch(screenerCss, /169 211 239/);
  assert.doesNotMatch(screenerCss, /(input|select)[^{}]*:focus[^{}]*\{[^}]*box-shadow/);
  assert.doesNotMatch(backtestingCss, /(input|select)[^{}]*:focus[^{}]*\{[^}]*box-shadow/);
  assert.doesNotMatch(backtestingCss, /backtest-(date|amount)-control:focus-within\s*\{[^}]*box-shadow/);
});

test("the shared field layer loads after every page stylesheet", () => {
  const order = [...stylesIndex.matchAll(/styles\/([\w-]+)\.css/g)].map((match) => match[1]);
  const position = order.indexOf("forms");
  assert.ok(position > -1, "forms.css must be imported");
  for (const page of ["screener", "portfolio", "backtesting", "app"]) {
    assert.ok(position > order.indexOf(page), `forms.css must load after ${page}.css`);
  }
});

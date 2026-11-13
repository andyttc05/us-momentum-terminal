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

test("hover and focus resolve to the same shared pastel-yellow border", () => {
  assert.match(tokensCss, /--color-field-border-active:\s*#E4C35A/);
  assert.match(focusBlock, /border-color: var\(--color-field-border-active\)/);
  const hoverBlock = mediaBlock(formsCss, "@media (hover: hover) and (pointer: fine)");
  assert.match(hoverBlock, /border-color: var\(--color-field-border-active\)/);
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
  assert.match(focusBlock, /outline: none/);
  assert.match(focusBlock, /border-color: var\(--color-field-border-active\)/);
});

test("hover is limited to devices that can actually hover", () => {
  const hoverBlock = mediaBlock(formsCss, "@media (hover: hover) and (pointer: fine)");
  assert.match(hoverBlock, /input[^{]*:hover/);
  assert.match(hoverBlock, /select:hover/);
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
    formsCss.indexOf("@media (hover: none)") < formsCss.indexOf("/* Focus: same yellow edge"),
    "the touch reset must precede the focus rules",
  );
});

test("disabled and invalid fields keep their own appearance", () => {
  assert.match(formsCss, /select:focus:not\(:disabled\)/);
  assert.match(formsCss, /select:hover:not\(:disabled\)/);
  assert.match(formsCss, /:focus:not\(\[aria-invalid="true"\]\)/);
  assert.match(formsCss, /:hover:not\(:disabled\):not\(\[aria-invalid="true"\]\)/);
  assert.match(formsCss, /\.backtest-date-group\.is-invalid \.backtest-date-control \{\s*border-color: #D8848B/);
});

test("pages no longer paint their own field focus glow", () => {
  assert.doesNotMatch(screenerCss, /169 211 239/);
  assert.doesNotMatch(screenerCss, /(input|select)[^{}]*:focus[^{}]*\{[^}]*box-shadow/);
  assert.doesNotMatch(backtestingCss, /(input|select)[^{}]*:focus[^{}]*\{[^}]*box-shadow/);
  assert.doesNotMatch(backtestingCss, /backtest-(date|amount)-control:focus-within\s*\{[^}]*box-shadow/);
});

test("the shared field layer loads after every page stylesheet", () => {
  const order = [...stylesIndex.matchAll(/styles\/([\w-]+)\.css/g)].map((match) => match[1]);
  assert.equal(order.at(-1), "forms");
  assert.ok(order.includes("screener") && order.includes("backtesting"));
});

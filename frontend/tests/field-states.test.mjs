import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const formsCss = source("../src/styles/forms.css");
const stylesIndex = source("../src/styles.css");
const tokensCss = source("../src/styles/tokens.css");
const screenerCss = source("../src/styles/screener.css");
const componentsCss = source("../src/styles/components.css");
const backtestingCss = source("../src/styles/backtesting.css");

/** Comments describe the contract; only declarations are under test. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const formsRules = strip(formsCss);
const screenerRules = strip(screenerCss);
const componentsRules = strip(componentsCss);
const backtestingRules = strip(backtestingCss);

/** The bare-control focus rule, sliced out of the shared layer. */
const focusBlock = strip(formsCss.slice(formsCss.indexOf("/* Focus:"), formsCss.indexOf("/* Pill fields")));

/** Every stylesheet that could plausibly restyle a field. */
const allCss = [screenerRules, componentsRules, backtestingRules, formsRules].join("\n");

test("fields rest on a 1px beige edge", () => {
  assert.match(tokensCss, /--color-field-border:\s*#E9E2D9/);
  // The five visible edges of the app: search pill, filter controls, money
  // field, dropdown, date field. The date edge lives on the wrapper that the
  // user actually sees, not on the input inside it.
  assert.match(screenerCss, /\.screener-search \{[^}]*border: 1px solid var\(--color-field-border\);/s);
  assert.match(screenerCss, /\.screener-filter-field select, \.screener-filter-field input \{[^}]*border: 1px solid var\(--color-field-border\);/s);
  assert.match(componentsCss, /\.currency-input \{[^}]*border: 1px solid var\(--color-field-border\);/s);
  assert.match(componentsCss, /\.dropdown-control select \{[^}]*border: 1px solid var\(--color-field-border\);/s);
  assert.match(backtestingCss, /\.backtest-date-control \{[^}]*border: 1px solid var\(--color-field-border\);/s);
});

test("focus paints the warm-yellow edge", () => {
  assert.match(tokensCss, /--color-field-border-active:\s*#FFC83D/);
  assert.match(tokensCss, /--field-ring-width:\s*2px/);
  assert.match(focusBlock, /border-color: var\(--color-field-border-active\)/);
  assert.match(focusBlock, /outline: var\(--field-ring-width\) solid var\(--color-field-border-active\)/);
  assert.match(focusBlock, /outline-offset: calc\(-1 \* var\(--field-ring-width\)\)/);
});

test("hover is inert — no rule may restyle a field on hover", () => {
  assert.doesNotMatch(formsRules, /:hover/);

  for (const selector of [
    ".screener-search:hover",
    ".screener-search input:hover",
    ".screener-filter-field select:hover",
    ".screener-filter-field input:hover",
    ".currency-input:hover",
    ".currency-input input:hover",
    ".backtest-amount-control:hover",
    ".backtest-date-control:hover",
    ".backtest-date-input:hover",
    ".dropdown-control select:hover",
    ".dropdown-control:hover",
  ]) {
    assert.ok(!allCss.includes(selector), `${selector} must not exist`);
  }
  // No bare element may be tinted on hover either.
  assert.doesNotMatch(allCss, /[,\s](input|select|textarea)[^{}]*:hover/);
});

test("focus, not :active, is the trigger", () => {
  assert.match(focusBlock, /:focus:not\(:disabled\)/);
  assert.match(focusBlock, /input:where\([^\n]*:is\(:focus, :focus-visible\):not\(:disabled\):not\(\[aria-invalid="true"\]\)/);
  assert.doesNotMatch(formsRules, /:active/);
  // The pill wrappers ring while anything inside them holds focus.
  assert.match(formsRules, /\.screener-search:focus-within \{/);
  assert.match(formsRules, /\.currency-input:focus-within,/);
  assert.match(formsRules, /\.backtest-date-control:focus-within \{/);
});

test("the yellow edge fades in over 150–200ms", () => {
  assert.match(tokensCss, /--field-transition:\s*(\d+)ms ease/);
  const duration = Number(tokensCss.match(/--field-transition:\s*(\d+)ms/)[1]);
  assert.ok(duration >= 150 && duration <= 200, `transition is ${duration}ms`);
  assert.match(formsCss, /transition: border-color var\(--field-transition\), outline-color var\(--field-transition\)/);
  // The ring exists at rest as a transparent outline, so focus only animates
  // its colour — nothing appears, moves or scales.
  assert.match(formsCss, /outline: var\(--field-ring-width\) solid transparent;/);
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
  // No transform or scale anywhere near a field.
  assert.doesNotMatch(formsCss, /(transform|scale):/);
});

test("a pill's inner input never draws a second ring", () => {
  // The wrapper owns the edge; the inputs inside it are border-less.
  assert.match(formsCss, /\.backtest-date-control > \.backtest-date-input \{[^}]*outline: 0;/s);
  // ...and the page rules that clear the outline for the other two pills must
  // survive, otherwise those inputs draw a rectangle inside the pill.
  assert.match(screenerCss, /\.screener-search input \{[^}]*outline: 0;/s);
  assert.match(backtestingCss, /\.backtest-amount-control input \{[^}]*outline: 0;/s);
  // Real fields must not clear it, or the ring silently disappears.
  assert.doesNotMatch(screenerCss, /\.screener-filter-field select, \.screener-filter-field input \{[^}]*outline: 0;/s);
});

test("the date field has exactly one animated edge", () => {
  // The wrapper carries the border that is painted and the ring that focuses.
  assert.match(backtestingCss, /\.backtest-date-control \{[^}]*border: 1px solid var\(--color-field-border\);/s);
  // The input inside it withdraws from every paint channel the shared field
  // layer controls, `transition` included: a transitioning outline colour is
  // what used to fade a second, darker ring over the yellow one on blur.
  const reset = formsCss.match(/\.backtest-date-control > \.backtest-date-input \{([^}]*)\}/s);
  assert.ok(reset, "the date input reset rule must exist");
  assert.match(reset[1], /border: 0;/);
  assert.match(reset[1], /outline: 0;/);
  assert.match(reset[1], /box-shadow: none;/);
  assert.match(reset[1], /transition: none;/);
  // The input may not pick an edge back up anywhere else either.
  assert.doesNotMatch(backtestingRules, /\.backtest-date-input \{[^}]*border: 1px/s);
  assert.doesNotMatch(formsRules, /\.backtest-date-control input:focus/);
});

test("field states never paint a glow", () => {
  // `box-shadow: none` (clearing the browser's default) is the only shadow the
  // shared field layer may declare.
  for (const [, value] of formsCss.matchAll(/box-shadow:\s*([^;]+)/g)) {
    assert.equal(value.trim(), "none");
  }
  assert.doesNotMatch(formsCss, /box-shadow:\s*0 0 0/);
});

test("blur leaves no residue", () => {
  // Nothing in the shared layer is scoped to a hover or active state, and the
  // resting outline colour is transparent, so losing focus restores the beige
  // edge without a cleanup rule.
  const stateful = [...formsRules.matchAll(/^[^@{}\n]*:(hover|active)[^{}]*\{/gm)];
  assert.equal(stateful.length, 0);
  assert.match(formsCss, /solid transparent;/);
});

test("disabled and invalid fields keep their own appearance", () => {
  assert.match(formsCss, /:focus:not\(:disabled\)/);
  assert.match(formsCss, /input:where\([^\n]*:is\(:focus, :focus-visible\):not\(:disabled\):not\(\[aria-invalid="true"\]\)/);
  // The red edge sits on the same wrapper that owns the beige one, and only its
  // colour is overridden — no geometry change, no hidden outline to resurface.
  assert.match(formsCss, /\.backtest-date-group\.is-invalid \.backtest-date-control \{\s*border-color: #D8848B;\s*outline-color: transparent;\s*\}/);
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

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  VALUE_PILL,
  leaderPath,
  pillHeightFor,
  valuePillWidth,
  valueTextWidth,
} from "../src/utils/valuePill.js";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const performanceChart = source("../src/components/PerformanceChart.jsx");
const backtestingPage = source("../src/BacktestingPage.jsx");
const componentsCss = source("../src/styles/components.css");
const appCss = source("../src/styles/app.css");
const backtestingCss = source("../src/styles/backtesting.css");

test("label widths match the measured Nunito Sans 800 advances", () => {
  // References measured in the browser with the app's label face at 12px. The
  // browser rounds each glyph's advance to a sub-pixel, so allow 0.05px.
  const close = (actual, expected) => {
    assert.ok(Math.abs(actual - expected) < 0.05, `${actual} != ${expected}`);
  };
  close(valueTextWidth("$51,488"), 46.32);
  close(valueTextWidth("+414.9%"), 50.56);
  close(valueTextWidth("$312,963"), 53.52);
  close(valueTextWidth("−12.3%"), 43.36);
  // Compact notation must be measured too, not assumed to be digits.
  close(valueTextWidth("$1.23M"), 42.43);
  // Digits are tabular: the same count of digits is the same width.
  assert.equal(valueTextWidth("1111"), valueTextWidth("8888"));
});

test("widths scale with the label size and every pill has the same padding", () => {
  assert.equal(Number(valueTextWidth("$51,488", 9).toFixed(2)), 34.74);
  assert.equal(
    Number((valueTextWidth("$51,488", VALUE_PILL.compactFontSize) / valueTextWidth("$51,488")).toFixed(4)),
    0.75,
  );
});

test("a pill is the text plus one padding, and never narrower than the minimum", () => {
  assert.equal(valuePillWidth(["$51,488"]), 71); // 46.32 -> 47 + 24
  assert.equal(valuePillWidth(["+414.9%"]), 75); // 50.56 -> 51 + 24
  assert.equal(valuePillWidth(["1.0"]), VALUE_PILL.minWidth);
  assert.equal(valuePillWidth(["$51,488"], { compact: true }), 53); // 34.74 -> 35 + 18
  // All pills in a chart share the widest label, so the column stays even.
  assert.equal(valuePillWidth(["$51,488", "$312,963", "+9.9%"]), valuePillWidth(["$312,963"]));
  assert.equal(valuePillWidth([]), VALUE_PILL.minWidth);
});

test("a dollar label and its percentage counterpart get near-identical pills", () => {
  // The complaint this fixes: the dollar pill used to be 112 wide while the
  // percentage pill was 91 for labels of the same length.
  const dollars = valuePillWidth(["$48,841"]);
  const percent = valuePillWidth(["+388.4%"]);
  assert.ok(Math.abs(dollars - percent) <= 6, `pills drifted: ${dollars} vs ${percent}`);
});

test("heights and leader runways come from the one shared scale", () => {
  assert.equal(pillHeightFor(false), 24);
  assert.equal(pillHeightFor(true), 20);
  assert.equal(VALUE_PILL.paddingInline, 12);
});

test("the leader is a stub on one line and a single curve otherwise", () => {
  // It ends on the pill's left edge; the pill is painted over it afterwards.
  assert.equal(leaderPath(100, 50, 120, 50), "M 100 50 L 120 50");
  const curve = leaderPath(100, 50, 120, 90);
  assert.match(curve, /^M 100 50 C /);
  assert.match(curve, / 120 90$/);
});

test("both charts size their pills with the shared rule", () => {
  assert.match(performanceChart, /import \{[^}]*valuePillWidth[^}]*\} from "\.\.\/utils\/valuePill\.js"/s);
  assert.match(backtestingPage, /import \{[^}]*valuePillWidth[^}]*\} from "\.\/utils\/valuePill\.js"/s);
  assert.match(performanceChart, /const pillWidth = valuePillWidth\(/);
  assert.match(backtestingPage, /const pillWidth = valuePillWidth\(/);

  // The old fixed reserves are gone.
  assert.doesNotMatch(performanceChart, /const pillWidth = 82/);
  assert.doesNotMatch(backtestingPage, /isPercent \? 91 : 112/);
  assert.doesNotMatch(backtestingPage, /labelGutter = compact \? 96 : 148/);

  // One label face, one leader weight, one endpoint size.
  assert.match(componentsCss, /\.value-pill-label \{[^}]*font-size: 12px;[^}]*font-variant-numeric: tabular-nums;/s);
  assert.match(componentsCss, /\.value-pill-label--compact \{ font-size: 9px; \}/);
  assert.doesNotMatch(appCss + backtestingCss, /performance-chart__value-label|\.backtest-value-label/);
  assert.match(performanceChart, /className="value-pill-label"/);
  assert.match(backtestingPage, /value-pill-label/);
  assert.match(performanceChart, /r="4\.5"/);
});

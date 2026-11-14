import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const pointerHook = source("../src/components/useChartPointer.js");
const performance = source("../src/components/PerformanceChart.jsx");
const stockAnalysis = source("../src/StockAnalysisPage.jsx");
const backtesting = source("../src/BacktestingPage.jsx");
const appCss = source("../src/styles/app.css");
const stockCss = source("../src/styles/stock-analysis.css");
const backtestCss = source("../src/styles/backtesting.css");
const touchCss = source("../src/styles/touch.css");

test("one pointer gesture handles mouse, touch and pen chart interaction", () => {
  assert.match(pointerHook, /pointerType === "touch" \|\| pointerType === "pen"/);
  assert.match(pointerHook, /setPointerCapture/);
  assert.match(pointerHook, /releasePointerCapture/);
  assert.match(pointerHook, /requestAnimationFrame/);
  assert.match(pointerHook, /cancelAnimationFrame/);
  assert.match(pointerHook, /onPointerCancel/);
  assert.match(pointerHook, /onLostPointerCapture/);
  assert.match(pointerHook, /dismissRef\.current\?\.\(\)/);
});

test("every interactive chart uses the shared scrubbing gesture", () => {
  for (const page of [performance, stockAnalysis, backtesting]) {
    assert.match(page, /useChartPointer/);
    assert.match(page, /\{\.\.\.chartPointer\}/);
  }
  assert.equal((stockAnalysis.match(/useChartPointer\(/g) ?? []).length, 2);
  assert.equal((backtesting.match(/useChartPointer\(/g) ?? []).length, 2);
  assert.doesNotMatch(stockAnalysis, /touchStart\.current/);
});

test("charts reserve horizontal gestures while leaving vertical page scroll available", () => {
  for (const css of [appCss, stockCss, backtestCss]) {
    assert.match(css, /touch-action: pan-y/);
  }
  assert.match(pointerHook, /event\.preventDefault\(\)/);
  assert.match(stockCss, /\.stock-price-mobile-readout \{[\s\S]*?pointer-events: none/);
  assert.match(backtestCss, /\.backtest-floating-tooltip \{[\s\S]*?pointer-events: none/);
  assert.match(source("../src/styles/components.css"), /html \{[\s\S]*?overflow-x: clip/);
  assert.match(appCss, /\.app-shell \{[\s\S]*?overflow-x: clip/);
});

test("coarse-pointer tooltips use a top readout so short viewports cannot clip them", () => {
  for (const page of [performance, stockAnalysis, backtesting]) {
    assert.match(page, /useMediaQuery\("\(hover: none\), \(pointer: coarse\)"\)/);
    assert.match(page, /coarsePointer \? (?:8|tooltipMargin)/);
  }
});

test("coarse pointers receive comfortable shared control targets", () => {
  assert.match(touchCss, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(touchCss, /min-height: 44px/);
  assert.match(touchCss, /\.backtest-date-control,[\s\S]*?\.dropdown-control select/);
  assert.match(touchCss, /\.pagination-page-list button,[\s\S]*?\.pagination-arrow/);
  assert.match(touchCss, /\.portfolio-evolution__filters button \{ min-height: 44px; \}/);
});

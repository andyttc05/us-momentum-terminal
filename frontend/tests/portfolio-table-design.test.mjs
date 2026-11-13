import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const portfolioPage = source("../src/PortfolioPage.jsx");
const portfolioCss = source("../src/styles/portfolio.css");
const screenerCss = source("../src/styles/screener.css");

test("the Portfolio page preserves its table shell with component-level loading", () => {
  assert.doesNotMatch(portfolioPage, /portfolio-data-notice/);
  assert.doesNotMatch(portfolioCss, /portfolio-data-notice/);
  assert.match(portfolioPage, /<UpdateBar[\s\S]*ariaLabel="Refresh portfolio"/);
  assert.match(portfolioPage, /<TableSkeletonRows/);
  assert.match(portfolioPage, /<TableStateRow/);
  assert.match(portfolioPage, /<Pagination/);
});

test("Portfolio holding rows use the Screener row rhythm and hover treatment", () => {
  for (const css of [portfolioCss, screenerCss]) {
    assert.match(css, /@media \(min-height: 831px\) and \(min-width: 1101px\)[\s\S]*?height: 50px/);
    assert.match(css, /@media \(max-height: 830px\) and \(min-width: 1101px\)[\s\S]*?height: 44px/);
  }
  assert.match(portfolioCss, /\.portfolio-table tbody tr \{[^}]*transition: background-color 140ms ease/s);
  assert.match(
    portfolioCss,
    /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.portfolio-table tbody tr:hover \{ background: #FCFAF7; \}/,
  );
  assert.match(portfolioCss, /\.portfolio-table tbody tr:focus-within \{ background: #FCFAF7; \}/);
  assert.match(portfolioCss, /tbody tr:hover \.portfolio-ticker-cell \{ background: #FCFAF7; \}/);
});

test("Portfolio financial columns stay right aligned with matching badge sizes", () => {
  assert.match(portfolioCss, /\.portfolio-heading--market-cap,[^}]*text-align: right/s);
  assert.match(portfolioCss, /\.portfolio-weight-value-cell \{ text-align: right; \}/);
  assert.match(portfolioCss, /\.portfolio-score-cell \{ text-align: center; \}/);
  assert.match(portfolioCss, /\.portfolio-table th\.portfolio-heading--rank \{ text-align: center; \}/);
  assert.match(portfolioCss, /\.portfolio-score-cell span \{[^}]*min-width: 82px;[^}]*min-height: 31px/s);
  assert.match(portfolioCss, /\.portfolio-rank-cell span \{[^}]*width: 32px;[^}]*height: 32px/s);
});

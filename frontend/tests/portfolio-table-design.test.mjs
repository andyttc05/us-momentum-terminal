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

test("the holdings card is one table with its title inside the card, not a tabbed view", () => {
  assert.doesNotMatch(portfolioPage, /portfolioTabs|role="tablist"|role="tabpanel"/);
  assert.match(portfolioPage, /className="portfolio-holdings-card"\s*\n\s*title="Active Portfolio Holdings"/);
  assert.match(portfolioPage, /action=\{\([\s\S]*?<ExportMenu[\s\S]*?ariaLabel="Export the complete portfolio"/);
  assert.doesNotMatch(portfolioCss, /portfolio-tabs|portfolio-live-table|portfolio-performance-empty/);
  // Short, single-line headings; the "at rebalance" wording lives in the tooltip.
  assert.match(portfolioPage, /"Sector", "Sector at Rebalance"/);
  assert.match(portfolioPage, /"Score", "Score at Rebalance"/);
  assert.match(portfolioPage, /"Float Cap", "Float-Adjusted Market Cap at Rebalance"/);
  assert.match(portfolioPage, /"Weight", "Target Weight"/);
  assert.match(portfolioPage, /"Target Weight"/);
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
  // The ticker cell is an ordinary cell now: it is no longer pinned over the
  // scrolling columns, so it no longer needs its own hover repaint.
  assert.doesNotMatch(portfolioCss, /position:\s*sticky/);
});

test("Portfolio financial columns stay right aligned with matching badge sizes", () => {
  assert.match(portfolioCss, /\.portfolio-heading--market-cap,[^}]*text-align: right/s);
  assert.match(portfolioCss, /\.portfolio-weight-value-cell \{ text-align: right; \}/);
  assert.match(portfolioCss, /\.portfolio-score-cell \{ text-align: center; \}/);
  assert.match(portfolioCss, /\.portfolio-table th\.portfolio-heading--rank \{ text-align: center; \}/);
  assert.match(portfolioCss, /\.portfolio-score-cell span \{[^}]*min-width: 82px;[^}]*min-height: 31px/s);
  assert.match(portfolioCss, /\.portfolio-rank-cell span \{[^}]*width: 32px;[^}]*height: 32px/s);
});

test("Portfolio holdings columns use the requested aligned six-column proportions", () => {
  for (const [slug, percent] of [["rank", 5], ["ticker", 12], ["sector", 26], ["score", 13], ["market-cap", 24], ["final-weight", 20]]) {
    assert.match(portfolioCss, new RegExp(`\\.portfolio-col-${slug} \\{ width: ${percent}%; \\}`));
  }
  assert.match(portfolioCss, /min-width: 960px; table-layout: fixed/);
  assert.match(portfolioPage, /aria-label=\{`Sort by \$\{fullLabel\}`\}/);
  assert.match(portfolioPage, /title=\{fullLabel\}/);
});

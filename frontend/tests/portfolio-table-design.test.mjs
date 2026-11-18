import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const portfolioPage = source("../src/PortfolioPage.jsx");
const portfolioCss = source("../src/styles/portfolio.css");
const screenerCss = source("../src/styles/screener.css");
const tableCss = source("../src/styles/tables.css");

test("the Portfolio page preserves its table shell with component-level loading", () => {
  assert.doesNotMatch(portfolioPage, /portfolio-data-notice/);
  assert.doesNotMatch(portfolioCss, /portfolio-data-notice/);
  assert.match(portfolioPage, /<UpdateBar[\s\S]*ariaLabel="Refresh portfolio"/);
  assert.match(portfolioPage, /<TableSkeletonRows/);
  assert.match(portfolioPage, /<TableStateRow/);
  assert.match(portfolioPage, /<Pagination/);
});

test("the holdings card switches between two views from inside its own header", () => {
  assert.match(portfolioPage, /const portfolioViews = \[\["holdings", "Holdings"\], \["live", "Live Momentum"\]\]/);
  // Performance is gone; only holdings and live momentum remain.
  assert.doesNotMatch(portfolioPage, /"performance"|Performance/);
  // The title, the switch and Export all live in the card header, and the switch
  // is the same .period-control the Overview and Backtesting pages use.
  assert.match(portfolioPage, /className="portfolio-card-toolbar"[\s\S]*?dashboard-card__title[\s\S]*?className="period-control"[\s\S]*?<ExportMenu/);
  assert.match(portfolioPage, /activeView === "holdings" \? "Active Portfolio Holdings" : "Live Momentum Signals"/);
  // Short, single-line headings; the "at rebalance" wording lives in the tooltip.
  assert.match(portfolioPage, /"Sector", "Sector at Rebalance"/);
  assert.match(portfolioPage, /"Score", "Score at Rebalance"/);
  assert.match(portfolioPage, /"Float Cap", "Float-Adjusted Market Cap at Rebalance"/);
  assert.match(portfolioPage, /"Weight", "Target Weight"/);
  // No hand-rolled segmented control or status dot is left behind.
  assert.doesNotMatch(portfolioCss + portfolioPage, /portfolio-view-switch|portfolio-live-dot/);
  assert.doesNotMatch(portfolioPage + portfolioCss, /portfolio-tab-note|Latest scores update/);
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

test("both tables align their numbers the same way, with no decorative cells", () => {
  // Heading alignment lives once, in tables.css, so it cannot drift from the cells.
  assert.match(tableCss, /\.portfolio-table th\.portfolio-heading--rank \{ text-align: left; \}/);
  assert.match(tableCss, /\.portfolio-table th\.portfolio-heading--score,\n\.portfolio-table th\.portfolio-heading--status,\n\.portfolio-table th\.portfolio-heading--market-cap,\n\.portfolio-table th\.portfolio-heading--raw-weight,\n\.portfolio-table th\.portfolio-heading--final-weight \{ text-align: right; \}/);
  assert.doesNotMatch(portfolioCss, /portfolio-heading--/);
  assert.match(portfolioCss, /\.portfolio-number-cell \{ text-align: right; \}/);
  // Rank badges and score pills are gone: the two tables now share one cell style.
  assert.doesNotMatch(portfolioCss, /\.portfolio-score-cell|\.portfolio-rank-cell span|\.portfolio-weight-value-cell/);
  assert.match(portfolioPage, /<td className="portfolio-number-cell">/);
  assert.match(portfolioPage, /<td className="portfolio-rank-cell">/);
});

test("Portfolio holdings columns use the requested aligned six-column proportions", () => {
  for (const [slug, percent] of [["rank", 5], ["ticker", 12], ["sector", 26], ["score", 13], ["market-cap", 24], ["final-weight", 20]]) {
    assert.match(portfolioCss, new RegExp(`\\.portfolio-col-${slug} \\{ width: ${percent}%; \\}`));
  }
  assert.match(portfolioCss, /min-width: 960px; table-layout: fixed/);
  assert.match(portfolioPage, /aria-label=\{`Sort by \$\{fullLabel\}`\}/);
  assert.match(portfolioPage, /title=\{fullLabel\}/);
});

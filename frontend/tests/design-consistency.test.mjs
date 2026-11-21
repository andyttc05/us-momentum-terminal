import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const layoutCss = read("../src/styles/layout.css");
const componentsCss = read("../src/styles/components.css");
const backtestingCss = read("../src/styles/backtesting.css");
const stockCss = read("../src/styles/stock-analysis.css");
const portfolioCss = read("../src/styles/portfolio.css");
const screenerCss = read("../src/styles/screener.css");

const pages = {
  overview: read("../src/OverviewPage.jsx"),
  screener: read("../src/ScreenerPage.jsx"),
  portfolio: read("../src/PortfolioPage.jsx"),
  backtesting: read("../src/BacktestingPage.jsx"),
  stock: read("../src/StockAnalysisPage.jsx"),
};

test("every main page mounts the shared PageHeader", () => {
  for (const [name, source] of Object.entries(pages)) {
    if (name === "stock") continue; // a detail page: back link + company profile
    assert.match(source, /import \{ PageHeader \} from "\.\/components\/PageHeader\.jsx"/, `${name} must import PageHeader`);
    assert.match(source, /<PageHeader\b/, `${name} must render PageHeader`);
  }
  // The header's own type scale is declared once, in the layout system.
  assert.match(layoutCss, /\.page-header__title \{[^}]*font-size: var\(--font-size-page-title\)/s);
});

test("no page rescales the shared page header", () => {
  // Backtesting used to shrink its title to 2.15rem, which made the top-left
  // block read as a different design from the other pages.
  const sheets = [backtestingCss, portfolioCss, screenerCss, stockCss];
  for (const sheet of sheets) {
    assert.doesNotMatch(sheet, /page-header__title \{[^}]*font-size/s, "header title size belongs to tokens.css");
    assert.doesNotMatch(sheet, /page-header__eyebrow \{[^}]*font-size/s);
    assert.doesNotMatch(sheet, /page-header__subtitle \{[^}]*font-size/s);
  }
});

test("both charts use the one log-scale switch", () => {
  for (const page of [pages.stock, pages.backtesting]) {
    assert.match(page, /import \{ LogScaleToggle \} from "\.\/components\/LogScaleToggle\.jsx"/);
    assert.match(page, /<LogScaleToggle\b/);
  }
  // The two hand-rolled versions are gone, markup and CSS alike.
  for (const source of Object.values(pages)) {
    assert.doesNotMatch(source, /backtest-log-toggle|stock-price-scale-toggle|stock-switch|backtest-switch/);
  }
  for (const sheet of [backtestingCss, stockCss]) {
    assert.doesNotMatch(sheet, /backtest-log-toggle|stock-price-scale-toggle|\.stock-switch|\.backtest-switch/);
  }

  const toggle = read("../src/components/LogScaleToggle.jsx");
  assert.match(toggle, /role="switch"/);
  assert.match(toggle, /aria-checked=\{checked\}/);
  // One switch geometry for the whole app: the track is the shared component.
  assert.match(toggle, /className="toggle-control__track"/);
  assert.match(componentsCss, /\.toggle-control__track \{[^}]*width: 34px;[^}]*height: 20px;/s);
});

test("the log-scale pill is defined once, in the component layer", () => {
  const base = componentsCss.match(/\.log-scale-toggle \{([^}]*)\}/);
  assert.ok(base, "the pill must be declared in components.css");
  assert.match(base[1], /min-height: 44px;/);
  assert.match(base[1], /border: 1px solid var\(--color-line\)/);
  assert.match(componentsCss, /\.log-scale-toggle\[aria-checked="true"\] \.toggle-control__track \{ background: #EDB900; \}/);

  // A page may match its own pill-row density; it may not restate the design.
  for (const sheet of [backtestingCss, stockCss, portfolioCss, screenerCss, layoutCss]) {
    for (const [, body] of sheet.matchAll(/\.log-scale-toggle \{([^}]*)\}/g)) {
      assert.doesNotMatch(body, /background:|border:|font-size:|padding:/, "only min-height may be overridden per page");
    }
  }
});

test("the stock range pills are the shared segmented control", () => {
  assert.match(pages.stock, /className="period-control stock-range-control"/);
  assert.doesNotMatch(pages.stock, /stock-price-toolbar/);
  // No second pill design is left in the stock stylesheet.
  assert.doesNotMatch(stockCss, /\.stock-price-toolbar/);
  assert.ok(stockCss.includes(".stock-range-control { width: max-content; max-width: 100%; }"));
});

test("rank columns are plain numbers, like the Portfolio table's index", () => {
  const screener = read("../src/styles/screener.css");
  const app = read("../src/styles/app.css");
  // The circled chip put a second shape around every row for no extra meaning.
  assert.doesNotMatch(screener, /\.stock-rank-cell span \{[^}]*border-radius: 50%/s);
  assert.match(screener, /\.stock-rank-cell span \{[^}]*font-variant-numeric: tabular-nums;/s);
  assert.match(screener, /\.stock-rank-cell \{[^}]*text-align: left;/s);
  assert.doesNotMatch(app, /\.momentum-row__rank \{[^}]*border-radius: 50%/s);
  assert.match(app, /\.momentum-row__rank \{[^}]*color: var\(--color-text-secondary\);/s);
});

test("the backtest config controls share one baseline and one height", () => {
  const backtesting = read("../src/styles/backtesting.css");
  // Date pill, universe switch and run button are all 44px tall…
  assert.match(backtesting, /\.backtest-date-control \{[^}]*height: 44px;/s);
  assert.match(backtesting, /\.backtest-run-button \{\s*min-height: 44px;/);
  // …and the switch's padding + button height add up to the same 44px.
  assert.match(backtesting, /\.backtest-segmented button \{[^}]*min-height: 34px;/s);
  // Columns stretch to the tallest section, so headings sit on one edge and
  // controls on the other instead of three different baselines.
  assert.match(backtesting, /\.backtest-config \{[^}]*align-items: stretch;/s);
  assert.match(backtesting, /\.backtest-config__universe \{ justify-content: space-between; \}/);
  // The old 39px push that mis-aligned the run button is gone.
  assert.doesNotMatch(backtesting, /\.backtest-run-group \{[^}]*padding-top: 39px/s);
});

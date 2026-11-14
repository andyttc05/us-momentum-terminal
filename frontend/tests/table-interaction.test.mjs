import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isInteractiveTarget, shouldOpenRow, shouldRouteTickerClick, stockLinkLabel } from "../src/utils/rowNavigation.js";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const screenerPage = source("../src/ScreenerPage.jsx");
const portfolioPage = source("../src/PortfolioPage.jsx");
const portfolioEvolutionPage = source("../src/components/PortfolioEvolution.jsx");
const tablesCss = source("../src/styles/tables.css");
const stylesIndex = source("../src/styles.css");
const router = source("../src/router.jsx");

/** A click event whose target answers `closest()` the way the browser would. */
function click(target = { closest: () => null }, overrides = {}) {
  return { button: 0, target, defaultPrevented: false, ...overrides };
}

test("a plain click on the row body opens the stock", () => {
  assert.equal(shouldOpenRow(click()), true);
});

test("clicks that belong to a control inside the row are left alone", () => {
  let selector = "";
  const found = isInteractiveTarget({
    closest: (value) => { selector = value; return null; },
  });
  assert.equal(found, false);
  // Everything a row cell could legitimately contain and hand its own action to.
  for (const control of ["a", "button", "input", "select", "textarea", "label", "summary", "[role='button']", "[role='link']"]) {
    assert.ok(selector.includes(control), `row navigation must ignore ${control}`);
  }
  // ...and a real control short-circuits to "leave it alone".
  assert.equal(isInteractiveTarget({ closest: () => ({ tagName: "A" }) }), true);
  assert.equal(isInteractiveTarget(null), false);
});

test("modifier and secondary clicks keep the browser's behaviour", () => {
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    assert.equal(shouldOpenRow(click(undefined, { [modifier]: true })), false, modifier);
  }
  assert.equal(shouldOpenRow(click(undefined, { button: 1 })), false);
  assert.equal(shouldOpenRow(click(undefined, { defaultPrevented: true })), false);
});

test("the ticker link routes in-app only for a plain left click", () => {
  assert.equal(shouldRouteTickerClick(click()), true);
  assert.equal(shouldRouteTickerClick(click(undefined, { metaKey: true })), false);
  assert.equal(shouldRouteTickerClick(click(undefined, { button: 1 })), false);
  assert.equal(shouldRouteTickerClick(click(undefined, { defaultPrevented: true })), false);
});

test("the link label names the destination stock", () => {
  assert.equal(stockLinkLabel("mpc"), "Open MPC stock analysis");
  assert.equal(stockLinkLabel(" BRK.B "), "Open BRK.B stock analysis");
  assert.equal(stockLinkLabel(undefined), "Open  stock analysis");
});

test("all interactive stock tables render the same row link", () => {
  for (const page of [screenerPage, portfolioPage, portfolioEvolutionPage]) {
    assert.match(page, /className="stock-row"/);
    assert.match(page, /shouldOpenRow\(event\)/);
    assert.match(page, /shouldRouteTickerClick\(event\)/);
    assert.match(page, /href=\{stockPath\(/);
    assert.match(page, /aria-label=\{stockLinkLabel\(/);
    // The old per-cell navigation control is gone; the row owns the action now.
    assert.doesNotMatch(page, /stock-ticker-link"[\s\S]{0,40}onClick=\{\(\) => onSelectStock/);
  }
  // Tickers come from the single URL builder, never a hardcoded path.
  assert.match(router, /export function stockPath\(ticker\)/);
  assert.doesNotMatch(screenerPage, /\/stock\//);
  assert.doesNotMatch(portfolioPage, /\/stock\//);
  assert.doesNotMatch(portfolioEvolutionPage, /\/stock\//);
});

test("the shared table layer owns row feedback for every stock table", () => {
  assert.match(tablesCss, /\.stock-row \{\s*cursor: pointer;\s*transition: background-color 160ms ease;/);
  assert.match(tablesCss, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.stock-row:hover \{ background: #FCFAF7; \}/);
  assert.match(tablesCss, /\.stock-row:focus-within \{ background: #FCFAF7; \}/);
  assert.match(tablesCss, /\.portfolio-evolution__holdings-table \.stock-row:hover \{ background: transparent; \}/);
  // ...and it loads after the page sheets so those rules win. Only
  // orientation.css comes later, because it has to be able to hide the shell.
  const order = [...stylesIndex.matchAll(/styles\/([\w-]+)\.css/g)].map((match) => match[1]);
  assert.deepEqual(order.slice(-2), ["tables", "orientation"]);
  assert.ok(order.indexOf("tables") > order.indexOf("screener"));
  assert.ok(order.indexOf("tables") > order.indexOf("portfolio"));
});

test("all three tables share the exact ticker hover and focus treatment", () => {
  assert.match(
    tablesCss,
    /\.stock-row \.stock-ticker-link,\s*\.stock-row \.portfolio-ticker-link,\s*\.stock-row \.portfolio-evolution__ticker-link \{[\s\S]*?color: inherit;[\s\S]*?text-decoration: none;[\s\S]*?transition: color 160ms ease;/,
  );
  assert.match(
    tablesCss,
    /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.stock-row \.stock-ticker-link:hover,[\s\S]*?\.stock-row \.portfolio-ticker-link:hover,[\s\S]*?\.stock-row \.portfolio-evolution__ticker-link:hover \{ color: #8D6500; \}/,
  );
  assert.match(
    tablesCss,
    /\.stock-row \.portfolio-evolution__ticker-link:focus-visible \{[\s\S]*?outline: 2px solid #D7AB2E;/,
  );
  assert.doesNotMatch(
    tablesCss,
    /\.portfolio-evolution__ticker-link:hover \{[^}]*(?:background|font-weight|transform):/,
  );
});

test("each heading is aligned with the values it labels", () => {
  // The page sheets declare these on the class alone, which loses to `.table th`.
  for (const slug of ["price", "change", "momentum", "score"]) {
    assert.match(tablesCss, new RegExp(`\\.screener-table th\\.stock-heading--${slug}`));
  }
  assert.match(tablesCss, /\.screener-table th\.stock-heading--market-cap/);
  for (const slug of ["rank", "score", "market-cap", "raw-weight", "final-weight"]) {
    assert.match(tablesCss, new RegExp(`\\.portfolio-table th\\.portfolio-heading--${slug}`));
  }
});

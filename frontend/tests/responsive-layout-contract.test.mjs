// The responsive policy, as a contract.
//
// Desktop (≥ 1101px) and tablet (601–1100px) are the two platforms this
// application is designed for. A phone in landscape is served by the same
// tablet rules; a phone held upright gets one screen that asks the reader to
// rotate, and the application is not painted at all.
//
// What this file protects is the *absence* of a fourth design: there is no
// phone layout, no second component tree, no bottom navigation and no
// phone-only breakpoint left to drift. Those were the parts that had to be
// kept in sync by hand, and they are what the old mobile contract test was
// pinning in place.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const stylePath = (name) => `../src/styles/${name}`;

const styleNames = readdirSync(fileURLToPath(new URL("../src/styles", import.meta.url)))
  .filter((name) => name.endsWith(".css"));
const styles = Object.fromEntries(styleNames.map((name) => [name, source(stylePath(name))]));
const allCss = Object.values(styles).join("\n");
const stylesIndex = source("../src/styles.css");

const app = source("../src/App.jsx");
const layoutCss = styles["layout.css"];
const orientationCss = styles["orientation.css"];

/** Every `@media` prelude in the sheet, normalised to one line. */
const mediaQueries = (css) => [...css.matchAll(/@media\s+([^{]+)\{/g)].map((match) => match[1].replace(/\s+/g, " ").trim());

test("the three width bands are the only width bands", () => {
  const widthQueries = Object.values(styles).flatMap(mediaQueries).filter((query) => /max-width|min-width/.test(query));

  // Desktop / tablet / compact landscape / the capability-aware portrait
  // notice, plus deliberate tuning steps inside those bands.
  const allowed = new Set([
    "(max-height: 830px) and (min-width: 1101px)",
    "(min-height: 831px) and (min-width: 1101px)",
    "(max-height: 800px) and (min-width: 1101px)",
    "(max-width: 1100px)",
    "(min-width: 1101px) and (max-width: 1180px)",
    "(max-width: 1340px)",
    "(max-width: 1240px)",
    "(max-width: 1399px) and (min-width: 1101px)",
    "(max-width: 900px)",
    "(max-width: 900px) and (orientation: landscape)",
    "(min-width: 601px) and (max-width: 1100px)",
    "(max-width: 819px)",
    "(max-width: 819px) and (orientation: portrait)",
    "(max-width: 600px) and (orientation: portrait) and (pointer: coarse)",
  ]);

  for (const query of widthQueries) {
    assert.ok(allowed.has(query), `unexpected width breakpoint: ${query}`);
  }

  // The phone-era steps are gone, not merely unused.
  for (const gone of ["680px", "560px", "520px", "420px", "400px", "360px", "350px", "1199px", "1200px"]) {
    assert.ok(
      !new RegExp(`\\(max-width: ${gone}\\)`).test(allCss),
      `a phone-only breakpoint at ${gone} is still in the stylesheets`,
    );
  }
});

test("height is its own axis, so a short desktop keeps the desktop layout", () => {
  // A 1440 × 800 desktop compresses the same system; it does not become a tablet.
  assert.match(layoutCss, /@media \(max-height: 830px\) and \(min-width: 1101px\)/);
  assert.match(layoutCss, /@media \(max-height: 560px\)/);
  // Short viewports scroll the fixed sidebar instead of clipping its footer.
  assert.match(layoutCss, /@media \(max-height: 560px\) \{[\s\S]*?\.sidebar \{[\s\S]*?overflow-y: auto/);
});

test("tablet keeps the desktop structure with a narrower navigation", () => {
  const tablet = layoutCss.slice(layoutCss.indexOf("@media (max-width: 1100px) {"));

  // The rail is a width, not a different navigation: the labels go, the
  // destinations stay, and the content column starts after it.
  assert.match(tablet, /--sidebar-width: var\(--sidebar-compact-width\)/);
  assert.match(app, /<SidebarNav/);
  assert.match(app, /className="app-shell"/);
  assert.match(styles["components.css"], /\.sidebar \{[\s\S]*?position: fixed/);

  // The decorative header art is the only thing the tablet band gives up.
  assert.match(tablet, /\.page-header__art \{ display: none; \}/);
  // Side-card grids use available width rather than a named iPad model.
  assert.match(styles["app.css"], /repeat\(auto-fit, minmax\(min\(100%, 300px\), 1fr\)\)/);
  assert.match(styles["portfolio.css"], /repeat\(auto-fit, minmax\(min\(100%, 300px\), 1fr\)\)/);
});

test("no page hides the sidebar or adds a second navigation", () => {
  assert.doesNotMatch(allCss, /\.sidebar \{[^}]*display:\s*none/);
  for (const gone of ["mobile-tab-bar", "mobile-nav", "toast-inset"]) {
    assert.ok(
      !new RegExp(gone).test(allCss) && !new RegExp(gone).test(app),
      `${gone} is a phone-navigation leftover and must not come back`,
    );
  }
  // One navigation component, mounted once.
  assert.equal((app.match(/<SidebarNav\b/g) ?? []).length, 1);
});

test("phone portrait renders the notice and nothing else", () => {
  const portraitQuery = "@media (max-width: 600px) and (orientation: portrait) and (pointer: coarse)";
  const portrait = orientationCss.slice(orientationCss.indexOf(`${portraitQuery} {`));
  assert.ok(portrait.length > 0, "orientation.css must own the portrait band");
  assert.match(orientationCss, /max-width: 600px/);
  assert.match(orientationCss, /orientation: portrait/);
  assert.match(orientationCss, /pointer: coarse/);

  // Both halves of the switch live in the same query, which is what makes a
  // live rotation free: no reload, no React state to reset.
  assert.match(portrait, /\.app-shell \{ display: none; \}/);
  assert.match(portrait, /\.orientation-notice \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
  assert.match(portrait, /display: grid;[\s\S]*?place-items: center;/);
  assert.match(portrait, /min-height: 100svh;[\s\S]*?min-height: 100dvh;/);
  // Background scrolling is cancelled while the notice is on screen.
  assert.match(portrait, /html,\s*body \{[\s\S]*?overflow: hidden;/);

  // Cream ground, ink type, the pastel-yellow accent.
  assert.match(portrait, /background: var\(--color-cream\)/);
  assert.match(portrait, /color: var\(--color-ink\)/);
  const orientation = source("../src/components/OrientationNotice.jsx");
  assert.match(orientation, /fill="var\(--color-yellow\)"/);
  assert.equal((orientation.match(/<rect\b/g) ?? []).length, 2);
  assert.match(orientation, /width="120"[\s\S]*?height="120"[\s\S]*?viewBox="0 0 120 120"/);
  assert.match(orientation, /data-indicator="portrait"[\s\S]*?d="M25\.5 61\.5H35\.5"/);
  assert.doesNotMatch(orientation, /M26\.3 33\.3H34\.7/);
  assert.match(portrait, /\.orientation-notice__icon \{[\s\S]*?min-width: 108px;[\s\S]*?max-width: 124px;[\s\S]*?max-height: 124px;[\s\S]*?aspect-ratio: 1 \/ 1;/);
});

test("tablet portrait cannot be classified as a phone", () => {
  // The phone screen is bounded at 600 CSS pixels; an iPad Mini at 744px stays
  // in the tablet application even when its input media feature is coarse.
  assert.match(orientationCss, /@media \(max-width: 600px\) and \(orientation: portrait\) and \(pointer: coarse\)/);
  assert.doesNotMatch(orientationCss, /max-width: 767px|max-width: 768px/);
  assert.match(layoutCss, /tablet\s+601[–-]1100/);
});

test("the notice starts hidden and is not a page of its own", () => {
  const base = orientationCss.slice(0, orientationCss.indexOf("@media"));
  assert.match(base, /\.orientation-notice \{ display: none; \}/);

  // It is a sibling of the shell — hiding the shell must not hide the notice.
  const shellEnd = app.indexOf("</div>", app.indexOf('className="app-shell"'));
  const notice = app.indexOf("<OrientationNotice />");
  assert.ok(notice > shellEnd, "the notice is mounted outside the hidden shell");
  assert.equal((app.match(/<OrientationNotice\b/g) ?? []).length, 1);

  // No Screen Orientation API: support varies, and a media query answers the
  // only question there is.
  for (const page of [app, source("../src/components/OrientationNotice.jsx")]) {
    assert.doesNotMatch(page, /screen\.orientation|lockOrientation|orientation\.lock/);
  }
});

test("orientation.css loads last so it can hide the shell", () => {
  const order = [...stylesIndex.matchAll(/styles\/([\w-]+)\.css/g)].map((match) => match[1]);
  assert.equal(order.at(-1), "orientation", "orientation.css must be the last sheet");
  assert.ok(order.indexOf("orientation") > order.indexOf("layout"));
});

test("no JavaScript branches on viewport width any more", () => {
  // The breakpoints module existed only so the markup could agree with the
  // phone stylesheet about what a phone was. With one layout, it has no job.
  assert.equal(existsSync(fileURLToPath(new URL("../src/utils/breakpoints.js", import.meta.url))), false);

  const jsx = ["../src/App.jsx", "../src/ScreenerPage.jsx", "../src/PortfolioPage.jsx",
    "../src/OverviewPage.jsx", "../src/BacktestingPage.jsx", "../src/StockAnalysisPage.jsx",
    "../src/components/SectorAllocation.jsx", "../src/components/KpiCard.jsx"]
    .map((path) => source(path)).join("\n");

  assert.doesNotMatch(jsx, /max-width:\s*\d+px/, "a component must not decide layout from a width query");
  // Touch is a capability, not a width: that branch stays.
  assert.match(source("../src/StockAnalysisPage.jsx"), /useMediaQuery\("\(hover: none\), \(pointer: coarse\)"\)/);
});

test("both data tables render the same columns at every width", () => {
  const screener = source("../src/ScreenerPage.jsx");
  const portfolio = source("../src/PortfolioPage.jsx");

  // The rank column is never conditionally dropped: with one table there is no
  // second colgroup, no second column count and no second sticky offset.
  for (const page of [screener, portfolio]) {
    assert.doesNotMatch(page, /isPhone|isMobile|isTablet/);
    assert.doesNotMatch(page, /className="[a-z-]*col-rank" \/>\}/);
  }
  assert.match(screener, /const columnCount = 9;/);
  assert.match(portfolio, /const columnCount = 7;/);
  assert.match(screener, /<td className="stock-rank-cell">/);
  assert.match(portfolio, /<td className="portfolio-rank-cell">/);

  // Wide tables scroll inside their card rather than hiding columns.
  assert.match(styles["screener.css"], /\.screener-table-scroll \{[^}]*overflow-x: auto/s);
  assert.match(styles["portfolio.css"], /\.portfolio-table-scroll \{[^}]*overflow-x: auto/s);
});

test("the pagination range stays on screen at every width", () => {
  // It used to be hidden on phones. It is the only element that says how many
  // records the filters returned, so it is no longer dropped anywhere.
  assert.doesNotMatch(allCss, /\.table-pagination__range \{[^}]*display:\s*none/);
  assert.match(styles["pagination.css"], /@media \(max-width: 1100px\) \{[\s\S]*?\.table-pagination \{[\s\S]*?flex-wrap: wrap/);
});

test("Sector Allocation has one grouping, not a phone variant", () => {
  const component = source("../src/components/SectorAllocation.jsx");
  assert.doesNotMatch(component, /useMediaQuery|MOBILE_SECTOR_LIMIT|sector-allocation--compact/);
  assert.doesNotMatch(allCss, /sector-allocation--compact/);
});

test("the shared chrome keeps its touch and keyboard affordances", () => {
  // Removing the phone layouts must not remove the touch paths.
  assert.match(styles["tables.css"], /@media \(hover: none\)/);
  assert.match(styles["tables.css"], /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(styles["forms.css"], /:focus-visible/);
  // The skip-free shell still exposes a focus ring token.
  assert.match(styles["tokens.css"], /--focus-ring:/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const componentsCss = source("../src/styles/components.css");
const appCss = source("../src/styles/app.css");
const tokensCss = source("../src/styles/tokens.css");
const kpiCard = source("../src/components/KpiCard.jsx");
const portfolioPage = source("../src/PortfolioPage.jsx");

/** The single `.kpi-card__value { ... }` declaration block. */
const valueBlock = (() => {
  const start = componentsCss.indexOf(".kpi-card__value {");
  assert.ok(start >= 0, "components.css must declare the shared KPI value style");
  return componentsCss.slice(start, componentsCss.indexOf("}", start));
})();

test("there is exactly one KPI value style", () => {
  const declarations = [...componentsCss.matchAll(/^\.kpi-card__value[^{]*\{/gm)].map((match) => match[0].trim());
  assert.deepEqual(declarations, [".kpi-card__value {"]);
  // The old per-card size modifier, and the token that fed it, are gone.
  assert.doesNotMatch(componentsCss, /kpi-card__value--long/);
  assert.doesNotMatch(appCss, /kpi-card__value--long/);
  assert.doesNotMatch(tokensCss, /--font-size-kpi-long/);
});

test("the value style is one size, weight and line height", () => {
  assert.match(valueBlock, /font-size: var\(--font-size-kpi\)/);
  assert.match(valueBlock, /font-weight: var\(--font-weight-black\)/);
  assert.match(valueBlock, /line-height: 1\.1/);
  assert.match(valueBlock, /display: block/);
});

test("a value too wide for its card truncates instead of rescaling", () => {
  assert.match(valueBlock, /overflow: hidden/);
  assert.match(valueBlock, /white-space: nowrap/);
  assert.match(valueBlock, /text-overflow: ellipsis/);
  assert.match(valueBlock, /max-width: 100%/);
  // No fit-to-width trickery: the size never depends on the text.
  const sizes = [...valueBlock.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.deepEqual(sizes, ["var(--font-size-kpi)"]);
});

test("the full value stays reachable when the text is clipped", () => {
  assert.match(kpiCard, /title=\{typeof value === "string" \? value : undefined\}/);
});

test("no KPI card can shrink its own value", () => {
  assert.doesNotMatch(kpiCard, /longValue/);
  assert.doesNotMatch(portfolioPage, /longValue/);
  // The value size is one token at every viewport: the phone step that used to
  // re-declare it is gone with the rest of the phone layout, and nothing
  // replaces it in a media block.
  assert.doesNotMatch(appCss, /\.kpi-card__value \{[^}]*font-size/s);
});

test("all four Portfolio KPI cards go through the same component", () => {
  const start = portfolioPage.indexOf('className="overview-kpis portfolio-kpis"');
  const section = portfolioPage.slice(start, portfolioPage.indexOf("</section>", start));
  const cards = [...section.matchAll(/<KpiCard\b/g)];
  assert.equal(cards.length, 4);
  for (const label of ["Total Holdings", "Largest Holding", "Top 10 Weight", "Invested Capital"]) {
    assert.match(section, new RegExp(`label="${label}"`));
  }
  // Every card falls back to the same placeholder while the portfolio is not ready.
  const placeholders = [...section.matchAll(/\?\? pendingKpi|: pendingKpi/g)];
  assert.equal(placeholders.length, 4);
  assert.match(portfolioPage, /const pendingKpi = portfolioState\.kind === "loading" \? "Loading…" : "Unavailable";/);
});

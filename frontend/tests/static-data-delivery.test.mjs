import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));
const source = (value) => readFileSync(path(value), "utf8");
const publication = JSON.parse(source("../public/data/publication.json"));
const manifest = JSON.parse(source("../public/data/manifest.json"));

test("published snapshot is complete and carries every stock detail", () => {
  assert.equal(publication.meta.delivery, "static");
  assert.ok(publication.meta.generated_at);
  assert.ok(publication.meta.as_of);
  assert.ok(publication.stocks.length >= 180);
  assert.equal(manifest.stockCount, publication.stocks.length);
  assert.equal(manifest.detailCount, manifest.stockTickers.length);
  for (const ticker of manifest.stockTickers) {
    assert.ok(existsSync(path(`../public/data/stocks/${ticker}.json`)), `missing ${ticker}`);
  }
});

test("published snapshot supports every backtest schedule as an on-demand file", () => {
  assert.equal(publication.backtestSchedules, undefined);
  for (const portfolio of ["top100", "top20"]) {
    for (const frequency of ["monthly", "quarterly", "semiannual", "annual"]) {
      const relative = manifest.backtestFiles?.[portfolio]?.[frequency];
      assert.ok(relative, `${portfolio}/${frequency} path`);
      const block = JSON.parse(source(`../public/${relative.replace(/^data\//, "data/")}`));
      if (portfolio === "top20" && frequency === "monthly" && !block?.available) {
        assert.match(block.reason, /portfolio constraints infeasible/);
        continue;
      }
      assert.equal(block?.available, true, `${portfolio}/${frequency}`);
      assert.ok(block.dates.length > 20);
      assert.ok(block.strategy.length > 20);
      if (portfolio === "top20") {
        assert.equal(block.methodology?.selection, "top 20");
        assert.ok(block.rebalance_log?.length > 0);
        assert.ok(block.rebalance_log.every(({ count }) => count === 20));
      }
    }
  }
});

test("frontend hydrates cache first and uses same-origin static paths", () => {
  const provider = source("../src/api/MarketProvider.jsx");
  const client = source("../src/api/client.js");
  const updateBar = source("../src/components/UpdateBar.jsx");
  assert.match(provider, /readCachedPublication\(\)/);
  assert.match(provider, /writeCachedPublication\(payload\)/);
  assert.match(provider, /api\.backtestSchedule/);
  assert.match(client, /import\.meta\.env\.PROD \? "static" : "live"/);
  assert.match(client, /staticRequest\("publication\.json"/);
  assert.match(client, /staticRequest\(`backtests\//);
  assert.match(client, /backtestInputs:.*backtest-inputs\.json/);
  assert.match(client, /devCall\("backtest", config\)/);
  assert.match(client, /dedupe\(`stock:\$\{symbol\}`/);
  assert.match(updateBar, /DataStatusDialog/);
});

test("GitHub Pages deploys a static scheduled snapshot without secrets", () => {
  const workflow = source("../../.github/workflows/deploy-pages.yml");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron:\s*"23 22 \* \* 1-5"/);
  assert.match(workflow, /VITE_DATA_MODE:\s*static/);
  assert.match(workflow, /python data-service\/scripts\/export_static\.py/);
  assert.match(workflow, /export_static\.py --force/);
  assert.doesNotMatch(workflow, /FMP_API_KEY|TWELVEDATA_API_KEY/);
  assert.match(workflow, /data_status: \$\{\{ steps\.refresh_data\.outputs\.data_status \}\}/);
  // A preserved snapshot is still the data that is already live, so only a
  // genuinely failed build may skip the deploy — otherwise a UI change waits
  // for a data refresh that may never report "updated".
  assert.match(workflow, /if: needs\.build\.outputs\.data_status != 'failed'/);
});

test("production refreshes the latest published snapshot without a live-service dependency", () => {
  const workflow = source("../../.github/workflows/deploy-pages.yml");
  const client = source("../src/api/client.js");
  const provider = source("../src/api/MarketProvider.jsx");
  assert.match(workflow, /VITE_DATA_MODE:\s*static/);
  assert.doesNotMatch(workflow + client + provider, /onrender\.com|VITE_API_BASE_URL|VITE_BACKTEST_API_BASE_URL/);
  assert.match(client, /import\("\.\/devClient\.js"\)/);
  assert.match(provider, /if \(STATIC_MODE\)[\s\S]*throw new Error\("Custom-date browser calculations are not available yet; no server request was made\."\)/);
  assert.match(client, /staticRequest\("publication\.json", \{ noCache: force \}\)/);
  assert.match(provider, /load\(\{ isRefresh: true, trackCompletion: true, force: true \}\)/);
  assert.doesNotMatch(provider, /liveHealth|liveSnapshot|liveRefresh|LIVE_PROBE_INTERVAL/);
});

test("production JavaScript has no Render host or API backtest endpoint", () => {
  const assetsPath = path("../dist/client/assets");
  if (!existsSync(assetsPath)) return; // The CI workflow runs this after `npm run build`.
  const bundles = readdirSync(assetsPath).filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(path(`../dist/client/assets/${name}`), "utf8")).join("\n");
  assert.doesNotMatch(bundles, /onrender\.com|\/api\/backtest|VITE_API_BASE_URL|VITE_BACKTEST_API_BASE_URL/);
});

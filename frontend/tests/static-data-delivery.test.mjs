import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
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
  assert.match(client, /dedupe\(`stock:\$\{symbol\}`/);
  assert.match(updateBar, /DataStatusDialog/);
});

test("GitHub Pages deploys a static scheduled snapshot without secrets", () => {
  const workflow = source("../../.github/workflows/deploy-pages.yml");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron:\s*"23 22 \* \* 1-5"/);
  assert.match(workflow, /VITE_DATA_MODE:\s*static/);
  assert.match(workflow, /python data-service\/scripts\/export_static\.py/);
  assert.doesNotMatch(workflow, /FMP_API_KEY|TWELVEDATA_API_KEY/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { strFromU8, unzipSync } from "fflate";
import { buildBacktestExportData } from "../src/utils/backtestExport.js";
import { createWorkbookBytes, resolveSpreadsheetApi } from "../src/utils/exportFiles.js";
import { buildPortfolioCsv, buildPortfolioExportData } from "../src/utils/portfolioExport.js";
import { buildScreenerExportData } from "../src/utils/screenerExport.js";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const publication = JSON.parse(source("../public/data/publication.json"));

function backtestConfig(block, portfolio = "top100") {
  return {
    startDate: block.start,
    endDate: block.end,
    initialCapital: 10_000,
    cashflowEnabled: true,
    contributionAmount: 1_000,
    contributionFrequency: "monthly",
    rebalanceFrequency: "semiannual",
    reinvestDividends: true,
    inflationAdjusted: false,
    includeYtd: true,
    portfolio,
  };
}

function backtestExport(portfolio = "top100") {
  const block = publication.backtest[portfolio];
  return {
    block,
    data: buildBacktestExportData({
      window: { ...block, startsAtBacktestOrigin: true },
      block,
      config: backtestConfig(block, portfolio),
      stocks: publication.stocks,
      portfolios: publication.portfolios,
      meta: publication.meta,
      exportedAt: "2026-11-14T00:00:00Z",
    }),
  };
}

async function readWorkbook(sheets) {
  const bytes = await createWorkbookBytes(sheets);
  return {
    bytes,
    workbook: XLSX.read(bytes, { type: "array" }),
    archive: unzipSync(bytes),
  };
}

test("the workbook API resolves from the ESM build that browsers actually bundle", async () => {
  // Bundlers honour `module` (xlsx.mjs), which has no default export. Node
  // resolves `main` (xlsx.js) and adds a CJS interop default, so only a test
  // that reads the ESM entry guards the browser path.
  const esmNamespace = await import("xlsx/xlsx.mjs");
  assert.equal("default" in esmNamespace, false);
  assert.equal(esmNamespace.default, undefined);
  assert.equal(typeof resolveSpreadsheetApi(esmNamespace).utils.book_new, "function");

  // Any resolver that still hands back the CommonJS wrapper keeps working.
  assert.equal(resolveSpreadsheetApi({ default: esmNamespace }).utils, esmNamespace.utils);

  assert.throws(() => resolveSpreadsheetApi({}), /did not load correctly/);
  assert.throws(() => resolveSpreadsheetApi(undefined), /did not load correctly/);
});

test("all pages use the same ExportMenu component and page-specific data", () => {
  const backtesting = source("../src/BacktestingPage.jsx");
  const screener = source("../src/ScreenerPage.jsx");
  const portfolio = source("../src/PortfolioPage.jsx");
  for (const page of [backtesting, screener, portfolio]) {
    assert.match(page, /import \{ ExportMenu \}/);
    assert.match(page, /<ExportMenu[\s\S]*?onExport=\{export/);
    assert.match(page, /downloadWorkbookFile/);
  }
  assert.equal((backtesting.match(/<ExportMenu/g) ?? []).length, 1);
  assert.equal((screener.match(/<ExportMenu/g) ?? []).length, 1);
  assert.equal((portfolio.match(/<ExportMenu/g) ?? []).length, 1);
  assert.doesNotMatch(screener, /DownloadSimple|function exportCsv\(/);
  assert.doesNotMatch(portfolio, /DownloadSimple|function exportHoldingsCsv\(/);
});

test("the export popover is portalled, viewport-clamped and keyboard dismissible", () => {
  const menu = source("../src/components/ExportMenu.jsx");
  assert.match(menu, /createPortal/);
  assert.match(menu, /document\.body/);
  assert.match(menu, /window\.innerWidth - width - VIEWPORT_GAP/);
  assert.match(menu, /event\.key !== "Escape"/);
  assert.match(menu, /setOpen\(false\)/);
  assert.match(menu, /Excel Workbook \(\.xlsx\)/);
  assert.match(menu, /CSV \(\.csv\)/);
});

test("the export menu offers exactly two formats and no promotional extras", () => {
  const menu = source("../src/components/ExportMenu.jsx");
  const formats = menu.slice(menu.indexOf("const FORMATS"), menu.indexOf("function menuPosition"));
  assert.equal((formats.match(/id: "xlsx"|id: "csv"/g) ?? []).length, 2);
  assert.doesNotMatch(menu, /Recommended/);
  assert.doesNotMatch(menu, /What's included/i);
  assert.doesNotMatch(menu, /export-menu__recommended/);
  assert.doesNotMatch(menu, /re-?runs? the whole scan|Includes every/i);

  const css = source("../src/styles/export.css");
  assert.doesNotMatch(css, /export-menu__recommended/);
  // Two compact rows: a single 42px row and a 238px menu keep the label whole.
  assert.match(css, /\.export-menu__option \{[\s\S]*?min-height: 42px/);
  assert.match(css, /\.export-menu__option-copy strong \{[\s\S]*?white-space: nowrap/);
  assert.match(menu, /const MENU_WIDTH = 238;/);
});

test("the Screener Export trigger is the same shared button as Filters", () => {
  const screener = source("../src/ScreenerPage.jsx");
  const menu = source("../src/components/ExportMenu.jsx");
  const button = source("../src/components/AppButton.jsx");

  assert.match(screener, /triggerVariant="app"/);
  assert.match(screener, /triggerClassName="screener-toolbar__button"/);
  assert.match(screener, /<AppButton[\s\S]*?className=\{`screener-toolbar__button/);
  // The toolbar variant renders through AppButton, so height, padding, radius,
  // type and hover states cannot drift between the two buttons.
  assert.match(menu, /<AppButton[\s\S]*?variant="secondary"/);
  assert.match(menu, /className=\{`export-menu__app-trigger \$\{triggerClassName\}`\.trim\(\)\}/);
  assert.match(button, /className=\{`app-button app-button--\$\{variant\}/);
});

test("Backtesting CSV and workbook retain every configured trading date", async () => {
  const { block, data } = backtestExport();
  assert.equal(data.rowCount, block.dates.length);
  assert.equal(data.csv.split("\r\n").length, block.dates.length + 1);
  assert.deepEqual(
    data.workbookSheets.map((sheet) => sheet.name),
    [
      "Daily Performance",
      "Drawdown",
      "Account Balances",
      "Monthly Returns",
      "Rebalancing History",
      "Cash Flows",
      "Performance Summary",
      "Benchmark Comparison",
      "Backtest Settings",
    ],
  );
  assert.equal(data.workbookSheets[0].rows.length, block.dates.length + 1);
  assert.equal(
    data.workbookSheets[4].rows.length,
    block.rebalance_log.reduce((sum, event) => sum + Object.keys(event.holdings).length, 0) + 1,
  );
  const accountSheet = data.workbookSheets.find((sheet) => sheet.name === "Account Balances");
  assert.equal(accountSheet.rows.length, block.dates.length + 1);
  assert.deepEqual(accountSheet.rows[0].slice(0, 5), [
    "Date",
    "Strategy Balance",
    "Strategy Holdings Value",
    "Strategy Available Cash",
    "Strategy Units",
  ]);
  for (const row of accountSheet.rows.slice(1)) {
    assert.ok(Math.abs(row[1] - (row[2] + row[3])) < 1e-6);
    assert.ok(Math.abs(row[5] - (row[6] + row[7])) < 1e-6);
    assert.ok(Math.abs(row[9] - (row[10] + row[11])) < 1e-6);
  }
  const benchmarkSheet = data.workbookSheets.find((sheet) => sheet.name === "Benchmark Comparison");
  assert.deepEqual(benchmarkSheet.rows.slice(1).map((row) => row[0]), ["SPY", "SPMO"]);
  const summarySheet = data.workbookSheets.find((sheet) => sheet.name === "Performance Summary");
  const summary = new Map(summarySheet.rows.slice(1).map(([label, value]) => [label, value]));
  assert.ok(Math.abs(summary.get("Total Return") - block.metrics.cumulative_return) < 0.02);
  assert.equal(summary.get("Final Portfolio Value"), data.workbookSheets[0].rows.at(-1)[1]);

  const { workbook, archive } = await readWorkbook(data.workbookSheets);
  assert.deepEqual(workbook.SheetNames, data.workbookSheets.map((sheet) => sheet.name));
  assert.equal(workbook.Sheets["Daily Performance"]["!ref"], `A1:K${block.dates.length + 1}`);
  assert.equal(workbook.Sheets["Daily Performance"].B2.t, "n");
  assert.equal(workbook.Sheets["Daily Performance"].C3.t, "n");
  const firstSheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  assert.match(firstSheet, /state="frozen"/);
  assert.match(firstSheet, /<autoFilter\b/);
});

for (const [universe, count] of [["top100", 100], ["top20", 20]]) {
  test(`${universe} Screener exports every matching record, not the visible page`, async () => {
    const stocks = publication.stocks.slice(0, count);
    const data = buildScreenerExportData({
      stocks,
      universe,
      filters: { sector: "Technology" },
      search: "",
      meta: publication.meta,
    });
    assert.equal(data.rowCount, count);
    assert.equal(data.csv.split("\r\n").length, count + 1);
    assert.equal(data.workbookSheets[0].rows.length, count + 1);

    const { workbook } = await readWorkbook(data.workbookSheets);
    assert.equal(workbook.Sheets["Screener Results"]["!ref"], `A1:I${count + 1}`);
    assert.equal(workbook.Sheets["Screener Results"].D2.t, "n");
    assert.equal(workbook.Sheets["Screener Results"].F2.t, "n");
    assert.deepEqual(workbook.SheetNames, ["Screener Results", "Screening Settings"]);
  });

  test(`${universe} Portfolio exports every holding and matches table weights`, async () => {
    const portfolio = publication.portfolios[universe];
    const data = buildPortfolioExportData({
      portfolio,
      universe,
      meta: publication.meta,
      exportedAt: "2026-11-14T00:00:00Z",
    });
    assert.equal(data.rowCount, count);
    const csvRows = buildPortfolioCsv(portfolio.holdings).split("\r\n");
    assert.equal(csvRows.length, count + 1);
    for (const holding of portfolio.holdings) {
      assert.ok(csvRows.some((row) => row.includes(`,${holding.ticker},`) && row.endsWith(`,${holding.finalWeight}`)));
    }

    const { workbook } = await readWorkbook(data.workbookSheets);
    assert.deepEqual(workbook.SheetNames, [
      "Holdings",
      "Portfolio Summary",
      "Portfolio Constraints",
      "Portfolio Settings",
    ]);
    assert.equal(workbook.Sheets.Holdings["!ref"], `A1:H${count + 1}`);
    assert.equal(workbook.Sheets.Holdings.F2.t, "n");
    assert.equal(workbook.Sheets.Holdings.H2.t, "n");
    const constraintText = XLSX.utils.sheet_to_json(
      workbook.Sheets["Portfolio Constraints"],
      { header: 1 },
    ).flat().join(" ");
    assert.doesNotMatch(constraintText, /Fully Invested/);
  });
}

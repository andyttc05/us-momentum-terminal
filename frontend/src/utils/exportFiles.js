/**
 * Shared browser download and Excel workbook utilities.
 *
 * Workbook dependencies are loaded only when an Excel export is requested, so
 * the dashboard itself does not pay the spreadsheet parser cost on boot.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const EXCEL_FORMAT = Object.freeze({
  currency: "$#,##0.00",
  integer: "0",
  number: "0.00",
  percent: '0.00"%"',
  weight: '0.0000"%"',
});

export function exportTimestamp(date = new Date()) {
  return date.toISOString().replace(".000Z", "Z");
}

export function exportDateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBlobFile(filename, blob) {
  triggerDownload(blob, filename);
}

function columnLetter(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const digit = (value - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function applyFreezePane(xml) {
  const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
  if (/<pane\b/.test(xml)) return xml;

  const selfClosing = xml.replace(
    /<sheetView\b([^>]*)\/>/,
    `<sheetView$1>${pane}</sheetView>`,
  );
  if (selfClosing !== xml) return selfClosing;
  return xml.replace(/<\/sheetView>/, `${pane}</sheetView>`);
}

/**
 * Pick the SheetJS API object out of a module namespace.
 *
 * xlsx@0.18.5 ships `xlsx.mjs` as the `module` entry, and that build exposes
 * only named exports — there is no `default`. Bundlers honour the `module`
 * field, so `import("xlsx").default` is undefined in the browser, while Node
 * resolves `main` and does expose a CommonJS interop default. Accept both.
 */
export function resolveSpreadsheetApi(module) {
  const api = module?.utils ? module : module?.default;
  if (!api?.utils?.book_new) {
    throw new Error("The Excel export library did not load correctly.");
  }
  return api;
}

export async function loadSpreadsheetApi() {
  return resolveSpreadsheetApi(await import("xlsx"));
}

/**
 * Build a real .xlsx file from plain worksheet rows.
 *
 * Each sheet accepts:
 * - `name`, `rows`, `widths`
 * - `formats`, a map of zero-based column indexes to number formats
 * - `autoFilter`, which enables filtering when the first row is a header
 * - `freezeHeader`, which freezes the first row
 */
export async function createWorkbookBytes(sheets) {
  const [XLSX, { unzipSync, zipSync, strFromU8, strToU8 }] = await Promise.all([
    loadSpreadsheetApi(),
    import("fflate"),
  ]);
  const workbook = XLSX.utils.book_new();
  const freezeIndexes = [];

  sheets.forEach((sheet, index) => {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    worksheet["!cols"] = sheet.widths?.map((width) => ({ wch: width }));

    if (sheet.autoFilter && sheet.rows.length > 1) {
      worksheet["!autofilter"] = {
        ref: `A1:${columnLetter(sheet.rows[0].length - 1)}${sheet.rows.length}`,
      };
    }

    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < sheet.rows[rowIndex].length; columnIndex += 1) {
        const format = sheet.formats?.[columnIndex];
        if (!format) continue;
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const cell = worksheet[address];
        if (cell && cell.t === "n") cell.z = format;
      }
    }

    if (sheet.freezeHeader) freezeIndexes.push(index + 1);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  });

  const bytes = new Uint8Array(XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  }));
  if (!freezeIndexes.length) return bytes;

  // SheetJS Community Edition writes filters and number formats but not pane
  // metadata. Add the standard OOXML pane element after serialization.
  const archive = unzipSync(bytes);
  freezeIndexes.forEach((sheetNumber) => {
    const path = `xl/worksheets/sheet${sheetNumber}.xml`;
    if (!archive[path]) return;
    archive[path] = strToU8(applyFreezePane(strFromU8(archive[path])));
  });
  return zipSync(archive, { level: 6 });
}

export async function downloadWorkbookFile(filename, sheets) {
  const bytes = await createWorkbookBytes(sheets);
  triggerDownload(new Blob([bytes], { type: XLSX_MIME }), filename);
}

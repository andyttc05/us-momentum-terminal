/**
 * CSV helpers shared by the portfolio export.
 *
 * Numbers are written as plain numeric literals so Excel / Google Sheets /
 * pandas read them as numbers, text is quoted and escaped, and text that could
 * be executed as a spreadsheet formula is neutralised.
 */

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/** Quote and escape a text field, and defuse spreadsheet formula injection. */
export function escapeCsvText(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading =, +, -, @, tab or CR would be evaluated as a formula.
  if (FORMULA_TRIGGERS.includes(text[0])) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** Build one CSV row. Numbers stay numeric; everything else is escaped text. */
export function csvRow(values) {
  return values
    .map((value) => (typeof value === "number" && Number.isFinite(value) ? String(value) : escapeCsvText(value)))
    .join(",");
}

/** Download a UTF-8 (BOM) CSV file through the browser. */
export function downloadCsvFile(filename, csv) {
  // The BOM makes Excel open the file as UTF-8 instead of guessing the code page.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

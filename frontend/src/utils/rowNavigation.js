// Row-level navigation shared by the Screener table and the Holdings table.
//
// A whole row opens a stock, but the row itself is not a link: the ticker cell
// holds a real <a>, so keyboard users get a tab stop, Enter, the browser's own
// link affordances and an accessible name. The row click is a convenience layer
// on top, and it stays out of the way of anything interactive inside the row.

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
  "[data-row-navigation='ignore']",
].join(",");

/** True when the click landed on (or inside) a control that owns its own action. */
export function isInteractiveTarget(target) {
  return Boolean(target && typeof target.closest === "function" && target.closest(INTERACTIVE_SELECTOR));
}

/**
 * A plain left click on the row body should open the stock. Clicks on controls,
 * clicks with a modifier held (open in new tab/window) and secondary clicks are
 * left to the browser.
 */
export function shouldOpenRow(event) {
  if (!event || event.defaultPrevented) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (event.type === "auxclick") return false;
  return !isInteractiveTarget(event.target);
}

/**
 * The ticker anchor navigates in-app for a plain left click and keeps its real
 * href for everything else (new tab, new window, copy link, no JS).
 */
export function shouldRouteTickerClick(event) {
  if (!event || event.defaultPrevented) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/** The accessible name for a row's ticker link. */
export function stockLinkLabel(ticker) {
  return `Open ${String(ticker ?? "").trim().toUpperCase()} stock analysis`;
}

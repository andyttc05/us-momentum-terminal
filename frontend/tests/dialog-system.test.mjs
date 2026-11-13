import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const dialogsCss = source("../src/styles/dialogs.css");
const stylesIndex = source("../src/styles.css");
const componentsCss = source("../src/styles/components.css");
const dataSourceCss = source("../src/styles/data-source.css");
const appCss = source("../src/styles/app.css");
const projectInfo = source("../src/components/ProjectInfo.jsx");
const dataStatus = source("../src/components/DataStatusDialog.jsx");

/** Comments describe the contract; only declarations are under test. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const dialogsRules = strip(dialogsCss);

/** The rule body of a single selector, so assertions stay close to one block. */
const block = (css, selector) => {
  const index = css.indexOf(`${selector} {`);
  if (index === -1) return "";
  return css.slice(index, css.indexOf("}", index));
};

test("both dialogs are built from the same shared classes", () => {
  for (const shared of [
    "app-dialog",
    "app-dialog__panel",
    "app-dialog__close",
    "app-dialog__header",
    "app-dialog__icon",
    "app-dialog__eyebrow",
    "app-dialog__title",
    "app-dialog__description",
  ]) {
    assert.ok(projectInfo.includes(shared), `ProjectInfo must use ${shared}`);
    assert.ok(dataStatus.includes(shared), `DataStatusDialog must use ${shared}`);
  }
  // Native dialog semantics stay put: showModal, labelled heading, Escape and
  // backdrop-close all still come from the components.
  for (const page of [projectInfo, dataStatus]) {
    assert.match(page, /<dialog/);
    assert.match(page, /aria-labelledby=/);
    assert.match(page, /event\.target === event\.currentTarget/);
  }
  assert.match(projectInfo, /showModal\(\)/);
  assert.match(dataStatus, /showModal\(\)/);
});

test("each dialog offers the same close button, down to the icon size", () => {
  assert.match(projectInfo, /className="app-dialog__close"[^>]*aria-label="Close project information"/);
  assert.match(dataStatus, /className="app-dialog__close"[^>]*aria-label="Close data status"/);
  // One icon size, one weight, in both.
  assert.equal((projectInfo.match(/<X size=\{18\} weight="bold"/g) ?? []).length, 1);
  assert.equal((dataStatus.match(/<X size=\{18\} weight="bold"/g) ?? []).length, 1);
  assert.doesNotMatch(projectInfo, /<X size=\{19\}/);
});

test("the panel, scrim and close button are declared once, in dialogs.css", () => {
  const dialog = block(dialogsRules, ".app-dialog");
  assert.match(dialog, /width: min\(640px, calc\(100vw - 32px\)\);/);
  assert.match(dialog, /max-width: 640px;/);
  assert.match(dialog, /max-height: calc\(100dvh - 32px\);/);

  const scrim = block(dialogsRules, ".app-dialog::backdrop");
  assert.match(scrim, /background: rgb\(17 17 17 \/ 32%\);/);
  assert.match(scrim, /backdrop-filter: blur\(3px\);/);

  const panel = block(dialogsRules, ".app-dialog__panel");
  assert.match(panel, /padding: 28px 30px 24px;/);
  assert.match(panel, /border: 1px solid var\(--color-card-border\);/);
  assert.match(panel, /border-radius: var\(--radius-card\);/);
  assert.match(panel, /background: var\(--color-surface\);/);
  assert.match(panel, /box-shadow: var\(--shadow-float\);/);
  // Content scrolls inside the panel, never the page behind it.
  assert.match(panel, /overflow-y: auto;/);

  const close = block(dialogsRules, ".app-dialog__close");
  assert.match(close, /top: 16px;/);
  assert.match(close, /right: 16px;/);
  assert.match(close, /width: 36px;/);
  assert.match(close, /height: 36px;/);
  assert.match(close, /border-radius: 50%;/);
  assert.match(close, /background: var\(--color-surface-soft\);/);
  assert.match(close, /color: var\(--color-text-secondary\);/);

  const hover = block(dialogsRules, ".app-dialog__close:hover");
  assert.match(hover, /background: var\(--color-nav-hover\);/);
  assert.match(hover, /color: var\(--color-ink\);/);
});

test("the header reserves the close button's column in both dialogs", () => {
  const header = block(dialogsRules, ".app-dialog__header");
  // 16px offset + 36px button + a gap. Anything less and a long title can slide
  // under the X at narrow widths.
  const padding = Number(header.match(/padding-right: (\d+)px;/)[1]);
  assert.ok(padding >= 52, `header padding-right is ${padding}px`);
  assert.match(block(dialogsRules, ".app-dialog__icon"), /width: 42px;/);
  assert.match(block(dialogsRules, ".app-dialog__icon"), /background: var\(--color-yellow-soft\);/);
  assert.match(block(dialogsRules, ".app-dialog__title"), /font-size: 1\.55rem;/);
  assert.match(block(dialogsRules, ".app-dialog__eyebrow"), /font-size: var\(--font-size-eyebrow\);/);
});

test("no component sheet keeps its own modal chrome", () => {
  // The two dialogs used to carry a container, a scrim, a close button and a
  // header each. If one of these comes back, the two will drift apart again.
  const banned = [
    ".project-info-dialog",
    ".project-info__modal",
    ".project-info__close",
    ".project-info__header",
    ".project-info__eyebrow",
    ".data-status-dialog",
    ".data-status-dialog__panel",
    ".data-status-dialog__close",
    ".data-status-dialog__header",
    ".data-status-dialog__icon",
  ];
  const componentSheets = [strip(componentsCss), strip(dataSourceCss), strip(appCss)].join("\n");
  for (const selector of banned) {
    assert.ok(
      !new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s,{]`).test(componentSheets),
      `${selector} must not be declared outside dialogs.css`,
    );
  }
  // Only one `::backdrop` rule may exist in the whole frontend.
  const backdrops = [componentsCss, dataSourceCss, appCss, dialogsCss]
    .flatMap((css) => strip(css).match(/::backdrop/g) ?? []);
  assert.equal(backdrops.length, 1, "exactly one backdrop rule may exist");
});

test("the shared layer loads after the sheets it replaces", () => {
  const order = [...stylesIndex.matchAll(/styles\/([\w-]+)\.css/g)].map((match) => match[1]);
  const position = order.indexOf("dialogs");
  assert.ok(position > -1, "dialogs.css must be imported");
  for (const earlier of ["components", "data-source", "app"]) {
    assert.ok(position > order.indexOf(earlier), `dialogs.css must load after ${earlier}.css`);
  }
});

test("phones get one responsive contract for both dialogs", () => {
  const mobile = dialogsCss.slice(dialogsCss.indexOf("@media (max-width: 560px)"));
  assert.match(mobile, /\.app-dialog \{[^}]*width: calc\(100vw - 24px\);/s);
  assert.match(mobile, /\.app-dialog \{[^}]*max-height: calc\(100dvh - 24px\);/s);
  assert.match(block(mobile, ".app-dialog__panel"), /padding: 22px 18px;/);
  // Content-specific collapse, same breakpoint for both.
  assert.match(mobile, /\.project-info__links \{ grid-template-columns: 1fr; \}/);
  assert.match(mobile, /\.data-status-dialog__facts \{ grid-template-columns: 1fr; \}/);
});

test("motion is optional", () => {
  // The only transition in the shared chrome is the close button's colour, and
  // it is withdrawn when the reader asks for less motion.
  assert.match(dialogsCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(dialogsCss, /\.app-dialog__close,[\s\S]*?transition: none;/);
});

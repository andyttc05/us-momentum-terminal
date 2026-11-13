import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CaretDown,
  DownloadSimple,
  FileCsv,
  FileXls,
} from "@phosphor-icons/react";

const MENU_WIDTH = 264;
const VIEWPORT_GAP = 12;

function menuPosition(trigger, menuHeight = 124) {
  const rect = trigger?.getBoundingClientRect();
  if (!rect) return { top: 0, left: 0, width: MENU_WIDTH };
  const width = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
  const left = Math.min(
    Math.max(VIEWPORT_GAP, rect.right - width),
    window.innerWidth - width - VIEWPORT_GAP,
  );
  const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_GAP;
  const top = roomBelow >= menuHeight
    ? rect.bottom + 8
    : Math.max(VIEWPORT_GAP, rect.top - menuHeight - 8);
  return { top, left, width };
}

export function ExportMenu({
  onExport,
  disabled = false,
  busy = false,
  label = "Export",
  ariaLabel = "Export data",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: MENU_WIDTH });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const height = menuRef.current?.getBoundingClientRect().height ?? 124;
      setPosition(menuPosition(triggerRef.current, height));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutside(event) {
      if (
        !rootRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [open]);

  function choose(format) {
    setOpen(false);
    triggerRef.current?.focus();
    onExport?.(format);
  }

  return (
    <div className={`export-menu ${className}`.trim()} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="export-menu__trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || busy}
        onClick={() => setOpen((current) => !current)}
      >
        <DownloadSimple size={18} weight="regular" aria-hidden="true" />
        <span>{busy ? "Exporting…" : label}</span>
        <CaretDown className="export-menu__caret" size={14} weight="bold" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="export-menu__popover"
          role="menu"
          aria-label="Choose an export format"
          style={position}
        >
          <button type="button" role="menuitem" className="export-menu__option is-recommended" onClick={() => choose("xlsx")}>
            <span className="export-menu__format-icon export-menu__format-icon--excel">
              <FileXls size={20} weight="fill" aria-hidden="true" />
            </span>
            <span className="export-menu__option-copy">
              <strong>Excel Workbook (.xlsx)</strong>
            </span>
            <span className="export-menu__recommended">Recommended</span>
          </button>
          <button type="button" role="menuitem" className="export-menu__option" onClick={() => choose("csv")}>
            <span className="export-menu__format-icon export-menu__format-icon--csv">
              <FileCsv size={20} weight="fill" aria-hidden="true" />
            </span>
            <span className="export-menu__option-copy">
              <strong>CSV (.csv)</strong>
            </span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

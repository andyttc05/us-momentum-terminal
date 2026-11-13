import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  Info,
  X,
} from "@phosphor-icons/react";

const repositoryUrl = "https://github.com/andyttc05/us-momentum-terminal";

export function ProjectInfo() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="sidebar-nav__item sidebar-nav__item--secondary"
        aria-label="About this project"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="sidebar-nav__icon"><Info size={22} weight="regular" aria-hidden="true" /></span>
        <span className="sidebar-nav__label">About</span>
      </button>

      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby="project-info-title"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClose={() => setOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <section className="app-dialog__panel">
          <button type="button" className="app-dialog__close" aria-label="Close project information" onClick={close}>
            <X size={18} weight="bold" aria-hidden="true" />
          </button>

          <header className="app-dialog__header">
            <span className="app-dialog__icon"><Info size={22} weight="regular" aria-hidden="true" /></span>
            <div className="app-dialog__heading">
              <p className="app-dialog__eyebrow">About the project</p>
              <h2 id="project-info-title" className="app-dialog__title">US Momentum Terminal</h2>
              <p className="app-dialog__description">
                An academic research terminal for studying risk-adjusted US equity momentum,
                portfolio construction and historical behaviour.
              </p>
            </div>
          </header>

          <dl className="project-info__sections">
            <div>
              <dt>Data</dt>
              <dd>Validated GitHub Pages snapshots generated from Yahoo Finance by the Python pipeline.</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>12–1 momentum, daily volatility, cross-sectional scoring and constrained portfolio construction.</dd>
            </div>
            <div>
              <dt>Backtesting</dt>
              <dd>Monthly, quarterly, semiannual or annual signals, next-session execution and transaction costs.</dd>
            </div>
            <div>
              <dt>Limitations</dt>
              <dd>Curated stock universe, current fundamentals, historical survivorship limitations and end-of-day snapshots.</dd>
            </div>
          </dl>

          <p className="project-info__notice">Research and education only. Not investment advice.</p>

          <nav className="project-info__links" aria-label="Project documentation">
            <a href={`${repositoryUrl}#readme`} target="_blank" rel="noreferrer">
              <BookOpen size={18} weight="regular" aria-hidden="true" />
              <span>README</span>
              <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
            </a>
            <a href={`${repositoryUrl}/blob/main/docs/TECHNICAL_DOCUMENTATION.md`} target="_blank" rel="noreferrer">
              <FileText size={18} weight="regular" aria-hidden="true" />
              <span>Technical Documentation</span>
              <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
            </a>
          </nav>
        </section>
      </dialog>
    </>
  );
}

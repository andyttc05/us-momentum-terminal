import { Info } from "@phosphor-icons/react";

const repositoryUrl = "https://github.com/andyttc05/us-momentum-terminal";

/** Compact project disclosure that leaves the dashboard layout untouched. */
export function ProjectInfo() {
  return (
    <details className="project-info">
      <summary className="project-info__trigger" aria-label="About this project">
        <Info size={18} weight="bold" aria-hidden="true" />
        <span className="project-info__label">About</span>
      </summary>
      <div className="project-info__panel">
        <p className="project-info__eyebrow">Academic project</p>
        <h2>Momentum research terminal</h2>
        <p>
          This tool studies risk-adjusted 12–1 month momentum across a curated set of 200 US common stocks.
        </p>
        <dl>
          <div><dt>Data</dt><dd>Yahoo Finance through the Python service.</dd></div>
          <div><dt>Method</dt><dd>12–1 momentum, daily volatility, cross-sectional score, and a constrained model portfolio.</dd></div>
          <div><dt>Backtest</dt><dd>March/September signals, next-session execution, equal weights, and 0.10% costs.</dd></div>
          <div><dt>Limits</dt><dd>Current fundamentals and a curated universe introduce survivorship and selection bias.</dd></div>
        </dl>
        <p className="project-info__notice">Research and education only. Not investment advice.</p>
        <nav className="project-info__links" aria-label="Project documentation">
          <a href={`${repositoryUrl}#readme`}>README</a>
          <a href={`${repositoryUrl}/blob/main/docs/TECHNICAL_DOCUMENTATION.md`}>Technical documentation</a>
        </nav>
      </div>
    </details>
  );
}

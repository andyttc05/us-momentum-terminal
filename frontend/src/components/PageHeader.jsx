/**
 * The single page header used by every main dashboard page.
 *
 * Structure, spacing and typography live in the layout system (layout.css) so
 * Overview, Screener, Portfolio and Backtesting cannot drift apart. Pages only
 * supply the copy, an optional mascot and the right-hand controls.
 *
 * The mascot renders in its own grid track and never changes the header height.
 */
export function PageHeader({ eyebrow, title, subtitle, art, controls, className = "" }) {
  return (
    <header className={`page-header ${className}`.trim()}>
      <div className="page-header__copy">
        <p className="page-header__eyebrow">{eyebrow}</p>
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {art && <div className="page-header__art" aria-hidden="true">{art}</div>}
      {controls && <div className="page-header__controls">{controls}</div>}
    </header>
  );
}

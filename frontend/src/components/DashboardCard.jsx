export function DashboardCard({ title, eyebrow, action, headerContent, className = "", children }) {
  return (
    <section className={`dashboard-card ${className}`.trim()}>
      {(headerContent || title || eyebrow || action) && (
        <div className="dashboard-card__header">
          {headerContent || <>
            <div>
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              {title && <h3 className="dashboard-card__title">{title}</h3>}
            </div>
            {action && <div>{action}</div>}
          </>}
        </div>
      )}
      <div className="dashboard-card__body">{children}</div>
    </section>
  );
}

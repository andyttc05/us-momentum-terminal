export function DashboardCard({ title, eyebrow, action, className = "", children }) {
  return (
    <section className={`dashboard-card ${className}`.trim()}>
      {(title || eyebrow || action) && (
        <div className="dashboard-card__header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h3>{title}</h3>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="dashboard-card__body">{children}</div>
    </section>
  );
}

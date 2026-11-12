export function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="section-header">
      <div className="section-header__copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {description && <p className="section-header__description">{description}</p>}
      </div>
      {action && <div className="section-header__action">{action}</div>}
    </div>
  );
}

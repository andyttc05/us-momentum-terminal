import { Mascot } from "./Mascot.jsx";

export function KpiCard({ label, shortLabel, value = "—", detail, icon: Icon, tint = "cream", mascotVariant, mascotColor, longValue = false }) {
  return (
    <article className={`kpi-card kpi-card--${tint}`}>
      {mascotVariant && <Mascot className="kpi-card__mascot" variant={mascotVariant} color={mascotColor} size={104} />}
      <div className="kpi-card__top">
        <div className="kpi-card__label">
          {Icon && <Icon size={19} weight="regular" />}
          {shortLabel ? (
            <span>
              <span className="kpi-card__label-full">{label}</span>
              <span className="kpi-card__label-short">{shortLabel}</span>
            </span>
          ) : (
            <span>{label}</span>
          )}
        </div>
      </div>
      <strong className={`kpi-card__value${longValue ? " kpi-card__value--long" : ""}`}>{value}</strong>
      {detail && <p className="kpi-card__detail">{detail}</p>}
    </article>
  );
}

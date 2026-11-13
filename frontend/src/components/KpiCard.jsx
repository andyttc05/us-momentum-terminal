import { Mascot } from "./Mascot.jsx";

// Every KPI value is set in one size, weight and line height. A value that is
// wider than its card is truncated with an ellipsis — never rescaled — so four
// cards side by side always read as one row of numbers. The full value stays in
// the DOM (and in `title`) for assistive tech and for a hover tooltip.
export function KpiCard({ label, shortLabel, value = "—", detail, icon: Icon, tint = "cream", mascotVariant, mascotColor, valueTone = "" }) {
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
      <strong
        className={`kpi-card__value${valueTone ? ` is-${valueTone}` : ""}`}
        title={typeof value === "string" ? value : undefined}
      >{value}</strong>
      {detail && <p className="kpi-card__detail">{detail}</p>}
    </article>
  );
}

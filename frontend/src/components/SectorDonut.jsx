const radius = 45;
const circumference = 2 * Math.PI * radius;

export function SectorDonut({ sectors = [] }) {
  let offset = 0;
  const empty = !sectors.length;
  return (
    <div className="sector-donut-wrap">
      <svg className="sector-donut" viewBox="0 0 120 120" role="img" aria-label="Sector allocation">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--color-line)" strokeWidth="18" />
        {sectors.map((sector) => {
          const segment = (sector.value / 100) * circumference;
          const segmentOffset = offset;
          offset += segment;
          return (
            <circle
              key={sector.name}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={sector.color}
              strokeWidth="18"
              strokeDasharray={`${segment} ${circumference - segment}`}
              strokeDashoffset={-segmentOffset}
              transform="rotate(-90 60 60)"
            />
          );
        })}
        {/* Centred on the geometric centre of the donut hole: x/y = 60 with
            dominant-baseline central keeps the glyph box balanced on both axes
            regardless of the rendered chart size. */}
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" className="sector-donut__number">{empty ? "—" : "100%"}</text>
      </svg>
    </div>
  );
}

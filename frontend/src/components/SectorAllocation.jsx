import { useMemo } from "react";
import { SectorDonut } from "./SectorDonut.jsx";
import { formatSectorPercent, getSectorAllocationGroups } from "../utils/sectorDisplay.js";

/** A compact, shared Top 6 + Other sector breakdown. */
export function SectorAllocation({ sectors = [], className = "" }) {
  const { groups } = useMemo(() => getSectorAllocationGroups(sectors), [sectors]);

  return (
    <div className={`sector-allocation ${className}`.trim()}>
      <SectorDonut sectors={groups} />
      <ul className="sector-legend sector-allocation__legend">
        {groups.map((sector) => sector.name === "Other" ? (
          <li key={sector.name} className="sector-allocation__other">
            <span className="sector-legend__name">
              <i style={{ "--sector-color": sector.color }} aria-hidden="true" />
              Other
            </span>
            <strong>{formatSectorPercent(sector.value)}</strong>
          </li>
        ) : (
          <li key={sector.name}>
            <span className="sector-legend__name">
              <i style={{ "--sector-color": sector.color }} aria-hidden="true" />
              {sector.name}
            </span>
            <strong>{formatSectorPercent(sector.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

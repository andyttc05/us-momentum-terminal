import { useMemo } from "react";
import { SectorDonut } from "./SectorDonut.jsx";
import { useMediaQuery } from "./useMediaQuery.js";
import { PHONE_MEDIA_QUERY } from "../utils/breakpoints.js";
import { MOBILE_SECTOR_LIMIT, SECTOR_GROUP_LIMIT, formatSectorPercent, getSectorAllocationGroups } from "../utils/sectorDisplay.js";

/**
 * A shared Top N + Other sector breakdown.
 *
 * Phones name one fewer sector (Top 5 + Other) so the legend stays legible;
 * desktop keeps its Top 6 + Other. Both the donut and the legend are built from
 * the same groups, so the two always describe the same allocation. Only the
 * grouping changes — the underlying sector values are never altered.
 */
export function SectorAllocation({ sectors = [], className = "" }) {
  const compact = useMediaQuery(PHONE_MEDIA_QUERY);
  const limit = compact ? MOBILE_SECTOR_LIMIT : SECTOR_GROUP_LIMIT;
  const { groups } = useMemo(() => getSectorAllocationGroups(sectors, limit), [sectors, limit]);

  return (
    <div className={`sector-allocation${compact ? " sector-allocation--compact" : ""} ${className}`.trim()}>
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

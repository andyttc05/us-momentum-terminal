import { useMemo } from "react";
import { DataState, Skeleton } from "./DataState.jsx";
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
export function SectorAllocation({ sectors = [], className = "", state = "ready" }) {
  const compact = useMediaQuery(PHONE_MEDIA_QUERY);
  const limit = compact ? MOBILE_SECTOR_LIMIT : SECTOR_GROUP_LIMIT;
  const { groups } = useMemo(() => getSectorAllocationGroups(sectors, limit), [sectors, limit]);
  const classes = `sector-allocation${compact ? " sector-allocation--compact" : ""} ${className}`.trim();

  if (state === "loading") {
    return (
      <div className={`${classes} sector-allocation--state`} data-state="loading" role="status" aria-busy="true">
        <span className="visually-hidden">Loading sector allocation…</span>
        <div className="sector-allocation__skeleton-donut" aria-hidden="true" />
        <ul className="sector-allocation__skeleton-legend" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index}>
              <Skeleton width="11px" height="11px" radius="50%" />
              <Skeleton width={`${58 + (index % 3) * 10}%`} height="10px" />
              <Skeleton width="28px" height="10px" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (state !== "ready") {
    return (
      <div className={`${classes} sector-allocation--state`} data-state={state}>
        <DataState
          state={state}
          title={state === "error" ? "Allocation unavailable" : "No allocation data"}
          detail={state === "error"
            ? "The latest valid allocation is not available."
            : "Verified sector weights have not been published yet."}
        />
      </div>
    );
  }

  return (
    <div className={classes}>
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

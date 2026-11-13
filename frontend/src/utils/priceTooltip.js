export const TOOLTIP_MOVEMENT_THRESHOLD = 4;
export const PRICE_TOOLTIP_WIDTH = 176;
export const PRICE_TOOLTIP_HEIGHT = 112;

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Pick the observation whose plotted x-coordinate is nearest the pointer. */
export function nearestObservationIndex(points, pointerX) {
  if (!points?.length || !Number.isFinite(pointerX)) return null;
  let bestIndex = 0;
  let bestDistance = Math.abs(points[0].x - pointerX);
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index].x - pointerX);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

/**
 * Keep the previous side while movement is inside the dead zone. The anchor is
 * reset only after a real change, so several tiny movements can accumulate into
 * one intentional direction change without producing a rapid back-and-forth.
 */
export function sideForMovement({
  pointerX,
  movementOriginX,
  currentSide,
  threshold = TOOLTIP_MOVEMENT_THRESHOLD,
}) {
  if (!Number.isFinite(movementOriginX)) {
    return { side: currentSide, movementOriginX: pointerX };
  }
  const delta = pointerX - movementOriginX;
  if (Math.abs(delta) < threshold) {
    return { side: currentSide, movementOriginX };
  }
  return {
    side: delta > 0 ? "left" : "right",
    movementOriginX: pointerX,
  };
}

/** Space-aware placement. Boundary containment wins over side preference. */
export function placePriceTooltip({
  anchorX,
  anchorY,
  preferredSide,
  containerWidth,
  containerHeight,
  tooltipWidth = PRICE_TOOLTIP_WIDTH,
  tooltipHeight = PRICE_TOOLTIP_HEIGHT,
  gap = 14,
  margin = 8,
}) {
  const maxX = Math.max(margin, containerWidth - tooltipWidth - margin);
  const maxY = Math.max(margin, containerHeight - tooltipHeight - margin);
  const canFitLeft = anchorX - gap - tooltipWidth >= margin;
  const canFitRight = anchorX + gap + tooltipWidth <= containerWidth - margin;

  let side = preferredSide;
  if (!side) side = canFitLeft || !canFitRight ? "left" : "right";
  if (side === "left" && !canFitLeft) side = "right";
  else if (side === "right" && !canFitRight) side = "left";

  const preferredX = side === "left"
    ? anchorX - gap - tooltipWidth
    : anchorX + gap;

  return {
    side,
    x: clamp(preferredX, margin, maxX),
    y: clamp(anchorY - tooltipHeight / 2, margin, maxY),
  };
}

export function formatTooltipDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? "");
  if (!match) return "—";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "—";
  return `${month} ${match[3]}, ${match[1]}`;
}

export const TOOLTIP_MOVEMENT_THRESHOLD = 4;
export const PRICE_TOOLTIP_WIDTH = 176;
export const PRICE_TOOLTIP_HEIGHT = 112;
export const CHART_TOOLTIP_GAP = 24;
export const CHART_TOOLTIP_MARGIN = 12;

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

/**
 * Keep one width for the whole chart while ensuring either side can hold the
 * card. Wide charts keep their designed size; only physically constrained
 * charts use the narrower version.
 */
export function fitTooltipWidth({
  containerWidth,
  preferredWidth,
  gap = CHART_TOOLTIP_GAP,
  margin = CHART_TOOLTIP_MARGIN,
}) {
  const widthAtCentre = (containerWidth - margin * 2) / 2 - gap;
  return Math.max(1, Math.min(preferredWidth, Math.floor(widthAtCentre)));
}

/**
 * Shared chart-tooltip placement. The pointer movement preference is honoured
 * while it fits; otherwise the card moves to the roomier side. Vertical
 * centring is clamped so top and bottom observations cannot clip the card.
 */
export function placePriceTooltip({
  anchorX,
  anchorY,
  preferredSide,
  containerWidth,
  containerHeight,
  rightBoundary = containerWidth,
  tooltipWidth = PRICE_TOOLTIP_WIDTH,
  tooltipHeight = PRICE_TOOLTIP_HEIGHT,
  gap = CHART_TOOLTIP_GAP,
  margin = CHART_TOOLTIP_MARGIN,
}) {
  const boundedRight = Math.min(containerWidth - margin, rightBoundary - margin);
  const maxX = Math.max(margin, boundedRight - tooltipWidth);
  const maxY = Math.max(margin, containerHeight - tooltipHeight - margin);
  const canFitLeft = anchorX - gap - tooltipWidth >= margin;
  const canFitRight = anchorX + gap + tooltipWidth <= boundedRight;

  // On first hover, point towards the side with more available room. Once the
  // pointer starts moving, its direction-aware preference takes over.
  let side = preferredSide ?? (anchorX <= containerWidth / 2 ? "right" : "left");
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

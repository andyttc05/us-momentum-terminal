export const BLINK_DELAY_MIN_MS = 3500;
export const BLINK_DELAY_MAX_MS = 7500;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function nextBlinkDelay(random = Math.random) {
  return BLINK_DELAY_MIN_MS + random() * (BLINK_DELAY_MAX_MS - BLINK_DELAY_MIN_MS);
}

export function shouldDoubleBlink(random = Math.random) {
  return random() < 0.24;
}

/**
 * Convert viewport pointer position into a small SVG-space eye offset.
 * The result is 0,0 when inactive or at the mascot centre.
 */
export function pointerEyeOffset(clientX, clientY, rect, {
  active = true,
  viewBoxWidth = 100,
  viewBoxHeight = 100,
  maxHorizontalPx = 2.8,
  maxVerticalPx = 1.8,
} = {}) {
  if (!active || !rect?.width || !rect?.height) return { x: 0, y: 0 };
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const normalizedX = clamp((clientX - centerX) / (rect.width / 2), -1, 1);
  const normalizedY = clamp((clientY - centerY) / (rect.height / 2), -1, 1);
  const scaleX = rect.width / viewBoxWidth;
  const scaleY = rect.height / viewBoxHeight;
  return {
    x: Number((normalizedX * maxHorizontalPx / scaleX).toFixed(2)),
    y: Number((normalizedY * maxVerticalPx / scaleY).toFixed(2)),
  };
}

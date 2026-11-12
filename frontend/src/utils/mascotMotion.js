export const BLINK_DELAY_MIN_MS = 3500;
export const BLINK_DELAY_MAX_MS = 7500;

export function nextBlinkDelay(random = Math.random) {
  return BLINK_DELAY_MIN_MS + random() * (BLINK_DELAY_MAX_MS - BLINK_DELAY_MIN_MS);
}

export function shouldDoubleBlink(random = Math.random) {
  return random() < 0.24;
}

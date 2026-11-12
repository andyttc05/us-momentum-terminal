# Task 30: Mascot Animation Report

Date: 12 November 2026

## Implemented Behavior

- Every `Mascot` and `MascotDuo` instance blinks independently using randomized delays between
  3.5 and 7.5 seconds.
- Blink compression lasts approximately 145–175ms and returns through the same smooth curve.
- A random subset of blinks is followed by a second blink about 195ms later.
- All blinking uses the existing eye ellipses and preserves their positions, sizes and spacing.
- The five main header `MascotDuo` instances track the mouse.
- Sidebar, KPI, banner and Momentum Score mascots do not track.

## Animation Architecture

Each mascot now has two nested SVG groups:

1. An outer tracking group receives a small SVG-space translation.
2. An inner group applies vertical blink compression around the eye pair's center.

This prevents tracking and blinking from competing for the same transform.

The shared hook:

- Uses one global pointer listener and one interpolated animation-frame source for all trackers.
- Converts pointer position into approximately ±2.8 rendered horizontal pixels and ±1.8 vertical
  pixels.
- Scales movement from mascot viewBox space so different mascot sizes remain subtle.
- Stops the pointer animation frame when movement settles.
- Uses individual timers rather than React renders.
- Pauses when the mascot is outside the viewport or the tab is hidden.
- Cleans up timers, Web Animations and pointer subscriptions.
- Disables blinking and tracking under `prefers-reduced-motion`.
- Disables tracking when `(hover: hover) and (pointer: fine)` is not available.

## Visual Verification

| Page | Visible blinking mascots | Eye trackers |
|---|---:|---:|
| Overview | 6 | 1 |
| Screener | 2 | 1 |
| Portfolio | 6 | 1 |
| Backtesting | 6 | 1 |
| Stock Analysis | 5 | 1 |

Observed Overview blinks began at different sample times for different instances, including
approximately 0.5s, 1.2s, 1.5s, 1.8s and 2.1s within separate observation windows. No visible
instance blinked in lockstep.

After the blink completed, every visible eye group returned to `transform: none`. No mascot remained
squashed.

Pointer movement changed the header tracking group from:

```text
translate(6.87 4.42)
```

to:

```text
translate(-6.87 2.32)
```

while the header remained exactly 104px high and the mascot artwork retained identical bounding-box
coordinates. The sidebar mascot had no tracking transform.

## Mobile

At 390px:

- The visible Overview banner mascot continued to blink.
- No visible mascot had pointer tracking enabled.
- Existing hidden/clipped mascot rules and responsive layout remained unchanged.

## Evidence

- `docs/task30-screenshots/overview-mascots.png`
- `docs/task30-screenshots/stock-analysis-mascots.png`
- `docs/task30-screenshots/overview-mobile-mascot.png`

## Verification

- Mascot motion utility tests: 4 passed.
- Full frontend/Sites test suite: 20 passed.
- Production build: passed.
- Browser console: no warnings or errors.
- Existing SVG paths and mascot dimensions were not changed.

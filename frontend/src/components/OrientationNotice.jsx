/**
 * The only phone-portrait screen the application has.
 *
 * Rendering it is a pure CSS decision: `orientation.css` shows this block and
 * hides `.app-shell` inside `@media (max-width: 767px) and (orientation: portrait)`.
 * The markup is therefore always mounted, and rotating the device swaps the two
 * views without a React update, a reload or a lost scroll position. Nothing here
 * reads the Screen Orientation API — Safari does not expose it consistently, and
 * a media query already answers the only question we have: is the viewport a
 * phone held upright.
 */
export function OrientationNotice() {
  return (
    <div className="orientation-notice" role="status" aria-live="polite">
      <div className="orientation-notice__inner">
        {/* A device held upright inside one clockwise arrow: the arc runs from
            10 o'clock round to 2 o'clock, and the arrowhead is a filled
            triangle on the arc's own tangent, so the two read as one stroke.
            Both the arc and the head are explicit coordinates — a dashed ring
            plus a floating chevron was tried first and looked like a handle at
            88px. */}
        <svg className="orientation-notice__icon" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
          <circle cx="48" cy="48" r="44" fill="var(--color-yellow)" />
          <path
            d="M42.44 16.5A32 32 0 1 0 78.07 37.06"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="5.4"
            strokeLinecap="round"
          />
          <path d="M81.1 45.5 73 38.9 83.2 35.2Z" fill="var(--color-ink)" />
          <rect
            x="37"
            y="32"
            width="22"
            height="32"
            rx="4.6"
            fill="var(--color-surface)"
            stroke="var(--color-ink)"
            strokeWidth="3.8"
          />
        </svg>
        <h1 className="orientation-notice__title">Please Rotate Your Device</h1>
        <p className="orientation-notice__subtitle">
          US Momentum Terminal is optimized for landscape viewing.
        </p>
      </div>
    </div>
  );
}

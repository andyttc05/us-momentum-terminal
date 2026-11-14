/**
 * The only phone-portrait screen the application has.
 *
 * Rendering it is a pure CSS decision: `orientation.css` shows this block and
 * hides `.app-shell` inside the capability-aware phone-portrait query.
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
        {/* Two device states and one short clockwise arc. Keeping the arrow
            between the phones, rather than wrapping around a single handset,
            makes the result unambiguous at notification size and avoids the
            reload-icon silhouette of a near-complete circle. */}
        <svg
          className="orientation-notice__icon"
          width="120"
          height="120"
          viewBox="0 0 120 120"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="60" cy="60" r="58" fill="var(--color-yellow)" />
          <g
            fill="var(--color-surface)"
            stroke="var(--color-ink)"
            strokeWidth="3.6"
            strokeLinejoin="round"
          >
            <rect x="18" y="26" width="25" height="43" rx="6" transform="rotate(-7 30.5 47.5)" />
            <rect x="63" y="68" width="39" height="24" rx="6" />
          </g>
          <path
            d="M42.2 35.5C48.5 18.2 73.2 14.4 88.7 29.5C97.3 37.8 98.6 49.7 93.6 59"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M85.5 51.3 93.6 59 100.8 51.7"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="4.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="orientation-notice__home-indicator"
            data-indicator="portrait"
            d="M25.5 61.5H35.5"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="2.2"
            strokeLinecap="round"
            transform="rotate(-7 30.5 61.5)"
          />
          <path
            className="orientation-notice__home-indicator"
            data-indicator="landscape"
            d="M77 88H88"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="2.2"
            strokeLinecap="round"
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

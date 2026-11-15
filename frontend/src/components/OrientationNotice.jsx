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

/* Icon geometry, in the 120 × 120 viewBox the SVG is drawn in.
 *
 * Every coordinate below is derived from one shared system rather than
 * eyeballed, because the whole mark is a set of rotated outlines and a
 * one-unit drift is visible at the 108px it is drawn at on a phone:
 *
 *   - both phones carry the same 3.6 stroke and a 7 corner radius on their
 *     short side (7 / 27 and 7 / 25.5), so they read as one device family;
 *   - each home indicator is drawn inside its phone's own transform, so it is
 *     centred on the phone's local axis and tilts with it;
 *   - both indicators sit 4.6 inside the inner bottom edge and are 34.5% of the
 *     inner width long, so neither phone is a special case.
 *
 * The arrow is a circular arc rather than a pair of cubics: the radius fixes
 * the curvature and hands the head an exact end tangent, which is what keeps
 * the two wings symmetric about the direction the shaft actually arrives from.
 */
const PORTRAIT_TILT = -8;
const PORTRAIT_CENTER = [33, 47.5];
const PORTRAIT_SIZE = [27, 45];
const LANDSCAPE_CENTER = [82.5, 82];
const LANDSCAPE_SIZE = [41, 25.5];
const PHONE_RADIUS = 7;
const PHONE_STROKE = 3.6;
const INDICATOR_STROKE = 2.4;

export function OrientationNotice() {
  const [px, py] = PORTRAIT_CENTER;
  const [pw, ph] = PORTRAIT_SIZE;
  const [lx, ly] = LANDSCAPE_CENTER;
  const [lw, lh] = LANDSCAPE_SIZE;
  // Half-length of each indicator: 34.5% of the phone's inner (fill) width.
  const portraitBar = ((pw - PHONE_STROKE) * 0.345) / 2;
  const landscapeBar = ((lw - PHONE_STROKE) * 0.345) / 2;
  // 4.6 inside the inner bottom edge of either phone.
  const portraitBarY = ph / 2 - PHONE_STROKE / 2 - 4.6;
  const landscapeBarY = lh / 2 - PHONE_STROKE / 2 - 4.6;

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
          {/* The shaft. A true circular arc (r = 32, 109°) rather than a pair
              of cubics: a circle cannot kink at a join, and it hands the head
              an exact tangent, so the arrow points straight down (2.5° off
              vertical) into the landscape phone.

              The shaft ends exactly where its 2px round cap becomes tangent to
              both wings (2 / sin 42° short of the vertex), which is what closes
              the junction: stopping any later left the cap bulging into the V
              and two notches on either side of it.

              The arc floats clear of both handsets. It used to start on the
              portrait phone's edge, which meant cutting across a 3.6-wide
              outline at a shallow angle and leaving a yellow wedge between the
              two strokes; starting 3.5 clear of the ink reads as one deliberate
              rotation gesture instead. */}
          <path
            d="M51 31.5A32 32 0 0 1 94.23 57"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* The head: ±42° off the end tangent, 8 long on each side, so both
              wings are the same length and the same angle from the shaft. */}
          <path
            d="M99.1 53.3 94.64 59.96 88.5 54.8"
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g
            fill="var(--color-surface)"
            stroke="var(--color-ink)"
            strokeWidth={PHONE_STROKE}
            strokeLinejoin="round"
          >
            <g transform={`translate(${px} ${py}) rotate(${PORTRAIT_TILT})`}>
              <rect
                x={-pw / 2}
                y={-ph / 2}
                width={pw}
                height={ph}
                rx={PHONE_RADIUS}
              />
              <path
                className="orientation-notice__home-indicator"
                d={`M${-portraitBar} ${portraitBarY}H${portraitBar}`}
                fill="none"
                strokeWidth={INDICATOR_STROKE}
                strokeLinecap="round"
              />
            </g>
            <g transform={`translate(${lx} ${ly})`}>
              <rect
                x={-lw / 2}
                y={-lh / 2}
                width={lw}
                height={lh}
                rx={PHONE_RADIUS}
              />
              <path
                className="orientation-notice__home-indicator"
                d={`M${-landscapeBar} ${landscapeBarY}H${landscapeBar}`}
                fill="none"
                strokeWidth={INDICATOR_STROKE}
                strokeLinecap="round"
              />
            </g>
          </g>
        </svg>
        <h1 className="orientation-notice__title">Please Rotate Your Device</h1>
        <p className="orientation-notice__subtitle">
          US Momentum Terminal is optimized for landscape viewing.
        </p>
      </div>
    </div>
  );
}

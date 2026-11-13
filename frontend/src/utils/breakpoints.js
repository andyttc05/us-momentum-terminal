/**
 * The single breakpoint the stylesheets use for the phone treatment
 * (`@media (max-width: 767px)` in app.css). Layout decisions that have to be
 * made in JavaScript — such as how many sector rows to render — read it here so
 * the markup and the CSS never disagree about what a phone is.
 */
export const PHONE_MEDIA_QUERY = "(max-width: 767px)";

/**
 * The breakpoint the two data tables switch at (`@media (max-width: 680px)` in
 * screener.css and portfolio.css). It is narrower than the phone breakpoint
 * because that is where the table cards drop to edge-to-edge scrolling. The
 * tables render a different number of columns on each side of it — the rank
 * column is not rendered on phones — so this has to be read in JavaScript too.
 */
export const PHONE_TABLE_MEDIA_QUERY = "(max-width: 680px)";

/**
 * The single breakpoint the stylesheets use for the phone treatment
 * (`@media (max-width: 767px)` in app.css). Layout decisions that have to be
 * made in JavaScript — such as how many sector rows to render — read it here so
 * the markup and the CSS never disagree about what a phone is.
 */
export const PHONE_MEDIA_QUERY = "(max-width: 767px)";

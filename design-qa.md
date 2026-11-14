# Portfolio Evolution Design QA

## Comparison Target

- Source visual truth: `docs/screenshots/portfolio-evolution-reference.png`
- Desktop implementation: `docs/screenshots/portfolio-evolution-desktop.png`
- Mobile implementation: `docs/screenshots/portfolio-evolution-mobile.png`
- Full-view comparison: `docs/screenshots/portfolio-evolution-qa-comparison.png`
- Focused panel comparison: `docs/screenshots/portfolio-evolution-qa-focus.png`
- Desktop viewport: 1440 x 1000 CSS px, 1x capture
- Mobile viewport: 390 x 844 CSS px, 1x capture
- Compared state: Top 20, Semiannual, latest event October 1, 2026, holdings view
- Source dimensions: 1774 x 887 px
- Desktop implementation dimensions: 1185 x 945 px (the section inside a 1440 px page)
- Mobile implementation dimensions: 358 x 1933 px (the section inside a 390 px page)
- Normalization: the source was scaled to the 1185 px implementation width, centered on
  `#F7F3EE`, and padded to the implementation height before side-by-side review.

The source concept shows a different sample dataset (100 holdings at 1.45% each). The
implementation was evaluated against the required real Top 20 data: 20 holdings at 5.00%,
13 New, 7 Retained, and 13 Removed. Those data differences are expected and mandated by the
task, not design drift.

## Findings

No actionable P0, P1, or P2 findings remain.

- [P3] Methodology note wraps to two lines at 1440 px.
  Location: Historical Holdings footer.
  Evidence: the source concept omits the note; the implementation must show it and wraps it
  once in the narrower, data-dominant right panel.
  Impact: none on comprehension or task completion; the note remains visually secondary.
  Fix if desired later: shorten the sentence without changing its meaning.

## Fidelity Review

- Fonts and typography: Nunito Sans is inherited from the application. Card titles, table
  headings, KPI values, metadata, and table rows follow the existing Backtesting hierarchy.
  The desktop history subtitle now stays on one line at the final panel proportion.
- Spacing and layout: KPI cards are equal-width and equal-height. The desktop master-detail
  split measures approximately 39.5% / 60.5%, with equal panel height and a 16 px gap.
  The holdings table shows ten rows at desktop density.
- Colors and visual tokens: the section uses only existing yellow, blue, lavender, mint, pink,
  surface, line, positive, and negative tokens. Selected and status states are distinct
  without heavy borders or shadows.
- Image and asset fidelity: the existing organic mascot component is reused unchanged in the
  KPI accents. All icons come from the existing Phosphor icon package. No replacement mascot,
  custom illustration, or decorative CSS art was introduced.
- Icons: Stack, history, calendar, turnover, search, export, status, and pagination icons align
  with the existing Phosphor family and control weights.
- Copy and content: actual event dates, signal dates, holdings counts, weights, turnover, and
  status labels are derived from the published event history. No rank, share quantity,
  execution price, or dollar transaction cost is fabricated.
- Responsive behavior: at 1280 and 1440 px the matrix remains side by side and the table fits
  without horizontal scrolling. At 1240 px and below it stacks cleanly. The 1024 px tablet view
  shows the full table. At 390 px there is no document overflow; the table has controlled
  internal scrolling (`304 px` viewport over `620 px` content), and search, filters, export,
  event rows, and pagination retain touch-sized controls.
- Accessibility: event buttons expose selected state, filters expose pressed state, table
  headings are semantic, search has a visible label, export retains its keyboard menu behavior,
  and focus treatments use the application field language.

## Comparison History

1. Initial desktop comparison found the four-row history page left a large unused column
   beside the ten-row holdings table. The history page was changed to the allowed five-row
   density. Post-fix evidence: `portfolio-evolution-desktop.png`.
2. Initial mobile review found the shared KPI media rule hid the required supporting text.
   A section-scoped override restored the event breakdown, scheduled-turnover label, and signal
   date. Post-fix evidence: `portfolio-evolution-mobile.png`.
3. Initial 1024 px review forced the holdings table to scroll in the two-column layout. The
   stacking breakpoint was moved to 1240 px; at 1024 px the table now fits all required columns.
   At 1280 px and above the matrix remains two-column. Post-fix evidence:
   `portfolio-evolution-qa-comparison.png`.
4. Mobile filters and pagination were below the intended touch target. They were raised to
   44 px, and the search text was set to 16 px to prevent mobile focus zoom. Measurements were
   rechecked at 390 px with no overflow and every control contained in its panel.

## Browser Verification

- Browser-rendered page: local Backtesting page against the published static snapshot.
- Desktop and mobile screenshots are saved at the paths above.
- Primary interactions tested:
  - switched from Top 100 to Top 20 and ran the backtest;
  - selected different event dates;
  - filtered All, New, Retained, and Removed;
  - confirmed removed rows use `Previous Weight`;
  - searched by company/ticker;
  - verified event changes reset search, filter, and holdings page;
  - filtered history by year;
  - downloaded the complete 20-row Top 20 CSV;
  - downloaded the two-sheet Top 20 Excel workbook;
  - verified the export filenames include universe, schedule, and execution date.
- Console check: no errors or warnings were captured during the final browser pass.

## Open Questions

None. The remaining visual differences are intentional adaptations to the existing US Momentum
Terminal design system and the actual published Top 20 dataset.

## Implementation Checklist

- Keep Portfolio Evolution directly below Performance Summary.
- Preserve the existing mascot and all current Backtesting sections.
- Keep the five-row history and ten-row holdings pagination contract.
- Preserve the actual event-derived KPI and comparison calculations.
- Preserve complete filtered exports across all pages.
- Re-run unit tests, production build, Sites tests, and deployed-page smoke checks after any
  future styling change.

## Follow-up Polish

- Consider shortening the historical weighting note if it begins to intrude on table density at
  smaller desktop widths.

final result: passed

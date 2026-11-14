# Rebalancing History Edge and Ticker Interaction QA

## Comparison Target

- Reference edge detail 1: `docs/screenshots/rebalancing-history-edge-reference-1.png`
- Reference edge detail 2: `docs/screenshots/rebalancing-history-edge-reference-2.png`
- Combined comparison: `docs/screenshots/rebalancing-history-qa-comparison.png`
- Desktop implementation: `docs/screenshots/portfolio-evolution-desktop.png`
- Mobile implementation: `docs/screenshots/portfolio-evolution-mobile.png`
- Desktop viewport: 1440 x 1000 CSS px, 1x capture
- Mobile viewport: 390 x 844 CSS px, 1x capture
- Reference dimensions: 152 x 134 px and 1912 x 140 px
- Desktop section dimensions: 1185 x 708 px
- Mobile section dimensions: 358 x 1552 px

The reference crops isolate the visual defects: an oversized rounded row edge and a visible
white gap between a white row and the yellow selected row. The implementation moves all clipping,
rounding, and outer framing to one list container.

## Findings

No actionable P0, P1, or P2 findings remain.

## Continuous List

- The event list is one 1px bordered container with a 14px radius and `overflow: hidden`.
- All five rows measure exactly 78px high.
- Adjacent-row gaps measure exactly `0px`.
- Every row is square (`border-radius: 0`) and has no shadow.
- Rows two through five share one straight 1px top separator.
- Every row reserves the same 4px left border; selection changes only its colour.
- The selected row uses a full-row `rgb(255, 245, 213)` fill and `#EDB900` accent.
- Selection changes did not alter row height or border width.
- The outer container alone clips the first and last row corners.

Measured before and after changing the selected event:

```text
row count:     5 before, 5 after
row height:    78px before, 78px after
border-left:   4px before, 4px after
vertical gaps: 0px before, 0px after
```

At 390px, the list remains 334px wide, all rows remain 78px high, and the document width remains
390px.

## Hover and Focus

The loaded CSSOM contains:

```css
.portfolio-evolution__event:hover:not(.is-selected) {
  background: var(--color-surface-soft);
}
```

No hover rule changes borders, padding, dimensions, or shadow. Keyboard focus uses an inset yellow
outline, which remains inside the rounded and clipped list container.

The browser automation surface does not expose a pointer-move primitive. The hover selector and
cascade were verified in the rendered page, while selected and unselected row geometry was
measured directly from the DOM.

## Ticker Interaction

One shared `tables.css` rule now governs Screener, Portfolio, and Historical Holdings tickers:

- inherited black text;
- transparent background;
- no underline;
- `transition: color 160ms ease`;
- hover text `#8D6500`;
- 2px `#D7AB2E` keyboard focus outline.

All three live tables were inspected. Their ticker links reported the same inherited colour,
transparent background, no underline, and 160ms color transition. The loaded CSSOM contains the
shared `#8D6500` hover rule. Clicking MU in Historical Holdings opened MU Stock Analysis, and
Browser Back returned to Backtesting.

## Functional and Responsive Verification

- Event selection, year filtering, turnover, signal dates, and pagination remain functional.
- The list remains continuous in desktop and mobile layouts.
- Mobile pagination was constrained so 20-page result sets no longer widen the document.
- Existing row and ticker navigation remain keyboard accessible.
- Browser console reports no errors or warnings.

## Test Results

- Frontend unit tests: **278 passed**
- Production build: **passed**
- Sites tests: **4 passed**
- The build reports a non-blocking bundle-size warning above 500kB.

## Implementation Checklist

- Keep clipping and rounding on the list container.
- Keep all rows square, 78px high, and flush together.
- Keep a single horizontal separator between rows.
- Keep the reserved 4px selection accent track.
- Keep ticker hover/focus rules in the shared table stylesheet.

## Follow-up Polish

- None required before acceptance.

final result: passed

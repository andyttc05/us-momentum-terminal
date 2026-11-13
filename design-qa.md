# Direction-Aware Price Tooltip — Design QA

**Final result: passed**

## Comparison target

- Source visual: `/Users/andyttc/Downloads/US Momentum Terminal Tooltip View.png`
- Source pixels: `1559 × 1009`; browser chrome removed at `y=132`, leaving a `1559 × 877` app viewport.
- Desktop implementation: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/tooltip-desktop-matched.png`
- Desktop implementation pixels: `1559 × 877`, CSS viewport `1559 × 877`, device scale factor `1`.
- Mobile implementation: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/tooltip-mobile-final.png`
- Mobile implementation pixels: `390 × 844`, CSS viewport `390 × 844`, device scale factor `1`.
- State: Stock Analysis, MPC, `12M`, selected observation and visible tooltip/readout.

The reference and implementation use live observations from different market-data snapshots, so dates and plotted prices are not expected to be numerically identical. Tooltip structure, placement language, chart treatment and surrounding design system are the fidelity target.

## Comparison evidence

- Full-view comparison: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/design-comparison-full.png`
- Focused chart comparison: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/design-comparison-chart.png`
- Focus crop: `820 × 520` from each app viewport, normalized to `780 × 494` per side.

The source and implementation were opened together in the combined comparison images before judging the result. Full-view inspection confirmed that the tooltip belongs only to the main price chart and that the surrounding page composition remains intact. Focused inspection confirmed tooltip hierarchy, card shape, marker, crosshair and percentage treatment.

## Findings

No actionable P0, P1 or P2 findings.

The tooltip contains exactly the three requested content items. Its white surface, soft shadow, compact radius, date hierarchy, prominent price and positive/negative percentage chips match the source design language. The selected marker is yellow with a light centre, and the dashed crosshair sits on the nearest actual plotted observation.

## Required fidelity surfaces

- Fonts and typography: Nunito Sans is preserved. The tooltip uses the existing black weight for the price, muted uppercase date text and a smaller black-weight percentage. No fallback-font or hierarchy drift was visible.
- Spacing and layout rhythm: The tooltip is `176 × 112` CSS px with a `14px` pointer gap and `8px` chart margin. The source is approximately `174 × 119`; the implementation is intentionally slightly more compact per the brief. No clipping or overflow was observed.
- Colors and visual tokens: The tooltip uses the existing surface, ink, muted text, soft positive and negative backgrounds, and yellow accent. Positive text resolves to `#078C47`; negative text resolves to `#D74B5B`.
- Image quality and assets: No new raster or decorative imagery was needed. Existing mascot assets and chart rendering are unchanged; the tooltip uses none of the prohibited placeholder-art techniques.
- Copy and content: Exactly three values render: date, price and daily percentage. No OHLC, volume, dollar change or “Daily Change” label is present.

## Interaction verification

- Continuous left-to-right movement placed the tooltip to the left of the selected point.
- Continuous right-to-left movement placed it to the right.
- The `4px` movement dead zone is covered by unit tests; small reversals do not switch sides until the accumulated movement crosses the threshold.
- At the left boundary the preferred side flipped right. At the right boundary it flipped left.
- Measured results: in a `617.72 × 293.63` chart, the left-boundary tooltip occupied `x=322.99–498.99, y=487.27–599.27`; the right-boundary tooltip occupied `x=557.04–733.04, y=333.24–445.24`. Both stayed completely within the chart container.
- The crosshair `x1` and highlighted marker `cx` matched exactly (`81.96` and `520` in the two boundary checks).
- The tooltip retained its position after movement stopped and disappeared with the crosshair and marker after leaving the chart.
- Positive and negative states were both exercised against actual observations; the negative sample rendered `DEC 12, 2025 / $183.64 / −0.72%` with the negative style.
- Tooltip layers resolve to `pointer-events: none`, so they do not intercept chart movement.
- Range switching clears selection. The tooltip then selects and displays observations from the newly visible range.
- At `390px`, the fixed mobile readout updates between tapped observations and does not follow the pointer.
- Browser console error log was empty after the interaction pass.

## Comparison history

1. Initial desktop capture showed text selection highlighting on axis labels after a pointer drag.
   - Fix: added `user-select: none` and the WebKit equivalent to the chart canvas.
   - Post-fix evidence: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/tooltip-desktop-matched.png`.
2. The selected marker was initially filled rather than matching the source’s yellow ring with a light centre.
   - Fix: changed the selected point to a white surface with a yellow stroke.
   - Post-fix evidence: `/Users/andyttc/Developer/US_Momentum_Terminal/qa-output/design-comparison-chart.png`.

## Follow-up polish

- The implementation tooltip is about 7px shorter than the reference card. This remains a P3 refinement because the compact height was explicitly requested and all content remains legible.
- Physical touch hardware was not available for QA. Touch paths are implemented with pointer down/up tracking and an `8px` tap slop; the mobile viewport interaction was exercised through coordinate activation.

## Implementation checklist

- Keep the tooltip limited to the main Stock Analysis price chart.
- Preserve boundary-first placement when adjusting the card dimensions.
- Re-run the frontend unit tests, Sites test, backend tests, and production build after any tooltip sizing change.

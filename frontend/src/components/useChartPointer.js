import { useCallback, useEffect, useRef } from "react";

function isDirectPointer(pointerType) {
  return pointerType === "touch" || pointerType === "pen";
}

/**
 * Shared pointer gesture handling for every interactive chart.
 *
 * `touch-action: pan-y` on the chart lets the browser own vertical page
 * scrolling while horizontal movement is delivered as pointer events. A
 * direct-pointer gesture captures its pointer so scrubbing stays smooth even
 * when the finger briefly leaves the SVG, and pointercancel clears the
 * selection if Safari turns the gesture into a page scroll.
 *
 * Selection work is coalesced to one update per animation frame. Mouse hover
 * still updates continuously, and a click remains a one-position selection.
 */
export function useChartPointer({ onSelect, onDismiss }) {
  const selectRef = useRef(onSelect);
  const dismissRef = useRef(onDismiss);
  const frameRef = useRef(0);
  const pendingXRef = useRef(null);
  const activePointerRef = useRef(null);

  selectRef.current = onSelect;
  dismissRef.current = onDismiss;

  const cancelPendingSelection = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    pendingXRef.current = null;
  }, []);

  const flushSelection = useCallback((clientX = pendingXRef.current) => {
    cancelPendingSelection();
    if (Number.isFinite(clientX)) selectRef.current?.(clientX);
  }, [cancelPendingSelection]);

  const queueSelection = useCallback((clientX) => {
    pendingXRef.current = clientX;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const pendingX = pendingXRef.current;
      pendingXRef.current = null;
      if (Number.isFinite(pendingX)) selectRef.current?.(pendingX);
    });
  }, []);

  const releasePointer = useCallback((event) => {
    const active = activePointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return true;
  }, []);

  useEffect(() => () => {
    cancelPendingSelection();
    activePointerRef.current = null;
  }, [cancelPendingSelection]);

  const onPointerDown = useCallback((event) => {
    if (!event.isPrimary && event.pointerType === "mouse") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    if (isDirectPointer(event.pointerType)) {
      activePointerRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      // Suppress the compatibility mouse sequence without changing `pan-y`
      // scrolling, which is controlled by the CSS touch-action property.
      event.preventDefault();
    }
    queueSelection(event.clientX);
  }, [queueSelection]);

  const onPointerMove = useCallback((event) => {
    const active = activePointerRef.current;
    if (isDirectPointer(event.pointerType)) {
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
    }
    queueSelection(event.clientX);
  }, [queueSelection]);

  const onPointerUp = useCallback((event) => {
    if (!isDirectPointer(event.pointerType)) return;
    if (activePointerRef.current?.pointerId !== event.pointerId) return;
    flushSelection(event.clientX);
    releasePointer(event);
  }, [flushSelection, releasePointer]);

  const onPointerCancel = useCallback((event) => {
    if (!isDirectPointer(event.pointerType)) return;
    cancelPendingSelection();
    releasePointer(event);
    dismissRef.current?.();
  }, [cancelPendingSelection, releasePointer]);

  const onPointerLeave = useCallback((event) => {
    if (activePointerRef.current || isDirectPointer(event.pointerType)) return;
    cancelPendingSelection();
    dismissRef.current?.();
  }, [cancelPendingSelection]);

  const onLostPointerCapture = useCallback((event) => {
    if (activePointerRef.current?.pointerId !== event.pointerId) return;
    activePointerRef.current = null;
    cancelPendingSelection();
    dismissRef.current?.();
  }, [cancelPendingSelection]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onLostPointerCapture,
  };
}

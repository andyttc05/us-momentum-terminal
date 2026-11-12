import { useEffect, useRef } from "react";
import {
  nextBlinkDelay,
  pointerEyeOffset,
  shouldDoubleBlink,
} from "../utils/mascotMotion.js";

const pointerSubscribers = new Set();
let pointerFrame = 0;
let pointerListenerAttached = false;
let pointerVisible = false;
let currentX = 0;
let currentY = 0;
let targetX = 0;
let targetY = 0;

function notifyPointer() {
  pointerSubscribers.forEach((subscriber) => subscriber({ x: currentX, y: currentY, active: pointerVisible }));
}

function runPointerFrame() {
  pointerFrame = 0;
  const easing = 0.24;
  currentX += (targetX - currentX) * easing;
  currentY += (targetY - currentY) * easing;
  const distance = Math.hypot(targetX - currentX, targetY - currentY);
  if (!pointerVisible && distance < 0.05) {
    currentX = 0;
    currentY = 0;
  }
  notifyPointer();
  if (pointerVisible || distance >= 0.05) pointerFrame = requestAnimationFrame(runPointerFrame);
}

function schedulePointerFrame() {
  if (!pointerFrame) pointerFrame = requestAnimationFrame(runPointerFrame);
}

function onPointerMove(event) {
  if (event.pointerType === "touch" || document.hidden) return;
  pointerVisible = true;
  targetX = event.clientX;
  targetY = event.clientY;
  schedulePointerFrame();
}

function onPointerLeave(event) {
  if (event.relatedTarget) return;
  pointerVisible = false;
  targetX = 0;
  targetY = 0;
  schedulePointerFrame();
}

function resetPointer() {
  pointerVisible = false;
  targetX = 0;
  targetY = 0;
  schedulePointerFrame();
}

function attachPointerListeners() {
  if (pointerListenerAttached) return;
  pointerListenerAttached = true;
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("mousemove", onPointerMove, { passive: true });
  window.addEventListener("pointerout", onPointerLeave, { passive: true });
  window.addEventListener("mouseout", onPointerLeave, { passive: true });
  window.addEventListener("blur", resetPointer);
  document.addEventListener("visibilitychange", resetPointer);
}

function detachPointerListeners() {
  if (!pointerListenerAttached) return;
  pointerListenerAttached = false;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("mousemove", onPointerMove);
  window.removeEventListener("pointerout", onPointerLeave);
  window.removeEventListener("mouseout", onPointerLeave);
  window.removeEventListener("blur", resetPointer);
  document.removeEventListener("visibilitychange", resetPointer);
}

function subscribePointer(subscriber) {
  pointerSubscribers.add(subscriber);
  attachPointerListeners();
  return () => {
    pointerSubscribers.delete(subscriber);
    if (!pointerSubscribers.size) {
      detachPointerListeners();
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      currentX = 0;
      currentY = 0;
      targetX = 0;
      targetY = 0;
      pointerVisible = false;
    }
  };
}

function mediaQuery(query) {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(query)
    : null;
}

function listenToMedia(query, handler) {
  if (!query) return () => {};
  if (query.addEventListener) query.addEventListener("change", handler);
  else query.addListener?.(handler);
  return () => {
    if (query.removeEventListener) query.removeEventListener("change", handler);
    else query.removeListener?.(handler);
  };
}

/**
 * Adds independent randomized blinking to one mascot and, when requested,
 * nested SVG eye tracking from one shared pointer source.
 */
export function useMascotAnimation({
  trackPointer = false,
  viewBoxWidth = 100,
  viewBoxHeight = 100,
} = {}) {
  const svgRef = useRef(null);
  const blinkRef = useRef(null);
  const trackingRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let visible = true;
    let blinkTimer = 0;
    let followupTimer = 0;
    const animations = new Set();
    const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");

    function cancelBlink() {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(followupTimer);
      blinkTimer = 0;
      followupTimer = 0;
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      if (blinkRef.current) blinkRef.current.style.transform = "none";
    }

    function canBlink() {
      return !disposed && visible && !document.hidden && !reducedMotion?.matches && Boolean(blinkRef.current);
    }

    function animateBlink(delay = 0) {
      followupTimer = window.setTimeout(() => {
        if (!canBlink()) return;
        const animation = blinkRef.current.animate(
          [
            { transform: "scaleY(1)" },
            { transform: "scaleY(0.12)", offset: 0.42 },
            { transform: "scaleY(1)" },
          ],
          {
            duration: 145 + Math.random() * 30,
            easing: "cubic-bezier(0.32, 0, 0.2, 1)",
          },
        );
        animations.add(animation);
        animation.finished.finally(() => animations.delete(animation)).catch(() => {});
      }, delay);
    }

    function scheduleBlink(delay = nextBlinkDelay()) {
      window.clearTimeout(blinkTimer);
      if (!canBlink()) return;
      blinkTimer = window.setTimeout(() => {
        if (!canBlink()) return;
        const doubleBlink = shouldDoubleBlink();
        animateBlink(0);
        if (doubleBlink) animateBlink(195);
        blinkTimer = window.setTimeout(
          () => scheduleBlink(),
          doubleBlink ? 420 : 240,
        );
      }, delay);
    }

    function onVisibilityChange() {
      if (document.hidden) cancelBlink();
      else scheduleBlink();
    }

    function onMotionChange() {
      if (reducedMotion?.matches) cancelBlink();
      else scheduleBlink();
    }

    const stopListeningMotion = listenToMedia(reducedMotion, onMotionChange);
    document.addEventListener("visibilitychange", onVisibilityChange);

    let observer;
    if (typeof IntersectionObserver !== "undefined" && svgRef.current) {
      observer = new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) scheduleBlink();
        else cancelBlink();
      });
      observer.observe(svgRef.current);
    } else {
      scheduleBlink();
    }

    return () => {
      disposed = true;
      cancelBlink();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopListeningMotion();
    };
  }, []);

  useEffect(() => {
    if (!trackPointer) return undefined;
    const finePointer = mediaQuery("(hover: hover) and (pointer: fine)");
    const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
    let unsubscribe = () => {};

    function neutral() {
      trackingRef.current?.removeAttribute("transform");
    }

    function update({ x, y, active }) {
      const svg = svgRef.current;
      if (!svg || reducedMotion?.matches || !finePointer?.matches || document.hidden) {
        neutral();
        return;
      }
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        neutral();
        return;
      }
      const offset = pointerEyeOffset(x, y, rect, {
        active,
        viewBoxWidth,
        viewBoxHeight,
      });
      trackingRef.current?.setAttribute("transform", `translate(${offset.x} ${offset.y})`);
    }

    function syncTracking() {
      unsubscribe();
      unsubscribe = () => {};
      if (finePointer?.matches && !reducedMotion?.matches) {
        unsubscribe = subscribePointer(update);
      } else {
        neutral();
      }
    }

    syncTracking();
    const stopFine = listenToMedia(finePointer, syncTracking);
    const stopReduced = listenToMedia(reducedMotion, syncTracking);
    return () => {
      unsubscribe();
      neutral();
      stopFine();
      stopReduced();
    };
  }, [trackPointer, viewBoxHeight, viewBoxWidth]);

  return { svgRef, blinkRef, trackingRef };
}

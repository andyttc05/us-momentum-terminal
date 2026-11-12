import { useEffect, useRef } from "react";
import { nextBlinkDelay, shouldDoubleBlink } from "../utils/mascotMotion.js";

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

/** Adds independent randomized blinking to one mascot. Eyes stay stationary. */
export function useMascotAnimation() {
  const svgRef = useRef(null);
  const blinkRef = useRef(null);

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

  return { svgRef, blinkRef };
}

import { useEffect, useRef, useState } from "react";

/**
 * Measures an element's content box so charts can draw themselves at 1:1 CSS
 * pixels.
 *
 * Charts used to ship a fixed `viewBox` and stretch it with
 * `preserveAspectRatio="none"`, which squashed text, turned endpoint circles
 * into ellipses and flattened rounded pills. With a measured box the SVG can
 * use `viewBox="0 0 width height"`, so one SVG unit equals one CSS pixel and
 * nothing is ever distorted — the chart simply re-lays itself out when its
 * card changes size.
 */
export function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((current) => (
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height }
      ));
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

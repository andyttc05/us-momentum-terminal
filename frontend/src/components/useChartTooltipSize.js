import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Measure the rendered tooltip instead of trusting per-chart size estimates.
 * Content wrapping can change the card height, especially on narrower charts.
 */
export function useChartTooltipSize() {
  const [element, setElement] = useState(null);
  const [size, setSize] = useState(null);
  const ref = useCallback((node) => setElement(node), []);

  useLayoutEffect(() => {
    if (!element) {
      setSize(null);
      return undefined;
    }

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width * 10) / 10;
      const height = Math.round(rect.height * 10) / 10;
      setSize((current) => (
        current?.width === width && current?.height === height
          ? current
          : { width, height }
      ));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, size];
}

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * The initial value is read synchronously, so the first paint already matches
 * the viewport and no flash of the wrong state is rendered.
 *
 * Viewport width is deliberately *not* asked here: the layout has one structure
 * per width band and it is decided entirely in CSS (see layout.css). The
 * remaining caller reads pointer capability, which changes when a mouse or a
 * tablet pen is attached — a rare, discrete event, so a plain `matchMedia`
 * listener is enough and no resize polling is needed.
 */
export function useMediaQuery(query) {
  const read = () => (typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false);

  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const list = window.matchMedia(query);
    const update = (event) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

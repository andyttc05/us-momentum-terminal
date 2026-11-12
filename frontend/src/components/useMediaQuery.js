import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * The initial value is read synchronously, so the first paint already matches
 * the viewport and no desktop-to-phone flash of the wrong layout is rendered.
 * Phones only fire this on rotation or when the URL bar collapses, which is why
 * a plain `matchMedia` listener is enough (no resize polling).
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

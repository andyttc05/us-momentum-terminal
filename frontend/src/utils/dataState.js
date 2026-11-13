/**
 * Resolve one section from the provider state. Existing data always wins:
 * cached or last-valid data remains visible while a refresh is in flight or
 * after that refresh fails. A settled response with no section data is empty.
 */
export function getSectionState({
  hasData,
  status,
  error,
  refreshing = false,
}) {
  if (hasData) return "ready";
  if (status === "error" || error) return "error";
  if (status === "loading" || status === "idle" || refreshing) return "loading";
  return "empty";
}

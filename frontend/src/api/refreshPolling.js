/** Poll a manifest-first check until Pages actually exposes a new publication. */
export async function waitForPublishedRefresh({
  check,
  timeoutMs,
  intervalMs,
  sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
}) {
  const deadline = now() + timeoutMs;
  let lastCheckError = null;
  while (now() < deadline) {
    await sleep(intervalMs);
    let result;
    try {
      result = await check();
    } catch (error) {
      // GitHub Pages updates its small files through a CDN. A manifest can
      // become visible a few seconds before the publication beneath it. Keep
      // polling in that case; the caller only applies a fully matching pair.
      const transientCodes = new Set([
        "publication_mismatch",
        "missing_snapshot",
        "static_failed",
        "offline",
        "timeout",
        "refresh_status_unavailable",
        "refresh_status_timeout",
      ]);
      if (!transientCodes.has(error?.code)) throw error;
      lastCheckError = error;
      continue;
    }
    // `changed` means a new publication is live. `settled` means the broker
    // finished the run and there is nothing newer to wait for — the caller
    // reports "up to date" instead of a timeout.
    if (result?.changed || result?.settled) return result;
  }
  const detail = lastCheckError?.message ? ` Last check: ${lastCheckError.message}` : "";
  const error = new Error(`The publication did not update before the refresh timed out.${detail}`);
  error.code = "refresh_timeout";
  error.cause = lastCheckError ?? undefined;
  throw error;
}

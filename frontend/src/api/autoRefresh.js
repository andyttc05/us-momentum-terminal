const AUTO_REFRESH_KEY = "umt:auto-refresh:v1";
let memoryClaimed = false;

/**
 * Claim the once-per-tab automatic refresh before any asynchronous work.
 * React StrictMode mounts effects twice in development; writing the claim
 * synchronously prevents both passes from requesting a workflow.
 */
export function claimAutomaticRefresh() {
  try {
    if (window.sessionStorage.getItem(AUTO_REFRESH_KEY)) return false;
    window.sessionStorage.setItem(AUTO_REFRESH_KEY, "claimed");
    return true;
  } catch {
    if (memoryClaimed) return false;
    memoryClaimed = true;
    return true;
  }
}

export function automaticRefreshClaimed() {
  try {
    return Boolean(window.sessionStorage.getItem(AUTO_REFRESH_KEY));
  } catch {
    return memoryClaimed;
  }
}

/**
 * Run the cached-first, background first-load refresh sequence. The claim is
 * synchronous and occurs before either the manifest load or Turnstile call.
 */
export async function runAutomaticRefresh({
  load,
  getChallenge,
  refresh,
  isMounted = () => true,
}) {
  if (!claimAutomaticRefresh() || !isMounted()) return { started: false };
  await load();
  if (!isMounted()) return { started: true, cancelled: true };
  try {
    const challengeToken = await getChallenge();
    if (!isMounted()) return { started: true, cancelled: true };
    await refresh({ challengeToken });
    return { started: true };
  } catch (requestError) {
    if (!isMounted()) return { started: true, cancelled: true };
    await refresh({ requestError });
    return { started: true, failed: true };
  }
}

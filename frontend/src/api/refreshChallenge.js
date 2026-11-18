const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
let scriptPromise;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("Refresh verification did not load."));
    script.onerror = () => reject(new Error("Refresh verification could not load."));
    document.head.append(script);
  });
  return scriptPromise;
}

/** Obtain a short-lived bot-verification assertion, never a GitHub token. */
export async function getRefreshChallenge() {
  // This hook makes local integration testing possible without weakening the
  // deployed broker. Production uses the Turnstile branch below.
  if (typeof window.__umtGetRefreshChallenge === "function") {
    return window.__umtGetRefreshChallenge();
  }
  if (!SITE_KEY) throw new Error("Market refresh verification is not configured for this deployment.");
  const turnstile = await loadTurnstile();
  return new Promise((resolve, reject) => {
    const target = document.createElement("div");
    target.hidden = true;
    document.body.append(target);
    let widgetId;
    const cleanup = () => {
      if (widgetId !== undefined) turnstile.remove(widgetId);
      target.remove();
    };
    widgetId = turnstile.render(target, {
      sitekey: SITE_KEY,
      size: "invisible",
      action: "refresh",
      callback: (token) => { cleanup(); resolve(token); },
      "error-callback": () => { cleanup(); reject(new Error("Refresh verification failed.")); },
      "expired-callback": () => { cleanup(); reject(new Error("Refresh verification expired.")); },
    });
    turnstile.execute(widgetId);
  });
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
let scriptPromise;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error("Verification did not load."));
    script.onerror = () => reject(new Error("Verification could not load."));
    document.head.append(script);
  });
  return scriptPromise;
}

const ACTIONS = {
  refresh: { label: "Refresh verification", hook: "__umtGetRefreshChallenge" },
  backtest: { label: "Backtest verification", hook: "__umtGetBacktestChallenge" },
};

/**
 * Obtain a short-lived bot-verification assertion, never a GitHub token.
 *
 * Each public action mints its own Turnstile action, so an assertion obtained
 * for one endpoint cannot be replayed against another.
 */
export async function getChallengeToken(action = "refresh") {
  const config = ACTIONS[action] || ACTIONS.refresh;
  // This hook makes local integration testing possible without weakening the
  // deployed broker. Production uses the Turnstile branch below.
  if (typeof window[config.hook] === "function") {
    return window[config.hook]();
  }
  if (!SITE_KEY) throw new Error(`${config.label} is not configured for this deployment.`);
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
      action,
      callback: (token) => { cleanup(); resolve(token); },
      "error-callback": () => { cleanup(); reject(new Error(`${config.label} failed.`)); },
      "expired-callback": () => { cleanup(); reject(new Error(`${config.label} expired.`)); },
    });
    turnstile.execute(widgetId);
  });
}

export const getRefreshChallenge = () => getChallengeToken("refresh");
export const getBacktestChallenge = () => getChallengeToken("backtest");

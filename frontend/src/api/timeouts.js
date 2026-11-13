// Render's free web services can delay the first request by 50 seconds or more
// while the instance wakes. Keep the browser's data-request budget above that
// documented cold-start window so a sleeping backend is not reported as failed.
export const DATA_REQUEST_TIMEOUT_MS = 90_000;


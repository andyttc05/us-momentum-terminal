// The optional live service may cold-start slowly. Static production requests
// use their own shorter timeout in client.js.
export const DATA_REQUEST_TIMEOUT_MS = 90_000;


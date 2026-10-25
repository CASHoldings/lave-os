/**
 * Validates configuration when the server starts, so a misconfigured deployment
 * (for example APP_MODE=demo with NODE_ENV=production) refuses to start instead of
 * failing on the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./config/env");
    getEnv();
  }
}

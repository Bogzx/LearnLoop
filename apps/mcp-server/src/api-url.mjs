// Shared resolution of the Trailhead API base URL for every mcp-server CLI.
//
// Trailhead ships no hosted API — the backend is self-hosted, so
// TRAILHEAD_API_URL is required config. We fall back to the port apps/api
// listens on (PORT ?? 3000), which is also the port the root
// docker-compose.yml publishes, and warn loudly on every fallback so an
// unconfigured run is never silently mistaken for a configured one.
//
// The warning goes to stderr (console.warn), leaving CLI stdout — which the
// smoke tests assert against — untouched.

export const DEFAULT_API_URL = 'http://localhost:3000';

/** Strip whitespace and any trailing slash so callers can append '/score'. */
function normalize(url) {
  return String(url).trim().replace(/\/+$/, '');
}

/**
 * Resolve the API base URL from (in order) an explicit --api-url flag value,
 * TRAILHEAD_API_URL, then the self-host default. Pass `{ quiet: true }` to
 * suppress the fallback warning when the caller prints its own banner.
 */
export function resolveApiUrl(flagUrl, { quiet = false } = {}) {
  const explicit = flagUrl || process.env.TRAILHEAD_API_URL;
  if (explicit && String(explicit).trim()) return normalize(explicit);
  if (!quiet) {
    console.warn(
      `! TRAILHEAD_API_URL is not set — falling back to ${DEFAULT_API_URL}\n` +
        '  Trailhead is self-hosted; there is no hosted API to fall back to.\n' +
        '  Start one with `docker compose up` from the repo root (see SELFHOSTING.md),\n' +
        '  or set TRAILHEAD_API_URL (or pass --api-url <url>) to point at your server.',
    );
  }
  return DEFAULT_API_URL;
}

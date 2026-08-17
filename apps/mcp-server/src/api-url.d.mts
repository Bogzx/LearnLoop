export const DEFAULT_API_URL: string;

export interface ResolveApiUrlOptions {
  /** Suppress the "TRAILHEAD_API_URL not set" fallback warning. */
  quiet?: boolean;
}

export function resolveApiUrl(
  flagUrl?: string | undefined,
  opts?: ResolveApiUrlOptions,
): string;

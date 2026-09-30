// Query-string parsing helpers.
//
// Extracted from index.ts so they can be unit-tested without booting the HTTP
// listener and Postgres pool that importing index.ts brings with it.

// Parse an integer query param and clamp it to [min, max]. Anything that is
// not a finite number (absent, '', 'abc') falls back to `def`. The previous
// inline `Math.max(1, Math.min(N, Number(raw ?? d)))` let NaN through — both
// Math.min and Math.max propagate it — so `?limit=abc` reached Postgres as
// `LIMIT NaN` and came back as a 500.
export function intParam(
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// True for a canonical 8-4-4-4-12 UUID. Ids that fail this are rejected with a
// 400 before they reach a `uuid` column, where Postgres would raise
// "invalid input syntax for type uuid" and the request would 500.
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

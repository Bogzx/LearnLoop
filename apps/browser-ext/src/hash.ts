// Tiny non-crypto hash. The store uses it to dedup `/score` calls and to key
// per-message lookups for the score-badge widget. Collisions are harmless
// here — they would only suppress one extra network call or surface a stale
// row, never block the user.
export function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(16);
}

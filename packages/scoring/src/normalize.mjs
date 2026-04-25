// Shared dedup normalizer. The MCP tool, the Stop hook, and the server-side
// dedup in /wiki/propose must all produce the same body_normalized string for
// the same insight, otherwise the reinforcement counter never increments.
//
// Rule (roadmap §3): lowercase + strip non-alphanumeric (collapse whitespace).
// Trailing/leading whitespace is trimmed. Letters from non-ASCII alphabets are
// preserved (Unicode property classes); only punctuation/symbols disappear.
export function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

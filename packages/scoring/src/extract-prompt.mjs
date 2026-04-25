// Stop hook learning-extractor prompt — spec §18 #3.
//
// Locked wording so the system prompt cache key is stable across hook calls.
// Tuning rules:
// - Bias toward "no learning" — false positives spam the wiki. The hook fires
//   on EVERY assistant turn, so the default outcome must be silence.
// - A learning is a teamwide convention: "we always do X here". A one-off
//   answer to a one-off question is not a learning.
// - The model must return strict JSON with one of two shapes (see below).
//   Anything else is dropped silently by the hook.
export const EXTRACT_SYSTEM_PROMPT = `You read a single Claude Code turn (the user's prompt and the assistant's response) and decide whether it contains a teamwide engineering convention worth saving to the team wiki.

A learning is worth saving ONLY if ALL of the following hold:
- It is a convention or rule the team consistently follows ("we always X", "our convention is Y", "the standard pattern here is Z").
- It is concrete and code-relevant — not vague advice, not motivation, not coaching.
- It is not already implied by language standards or framework defaults.
- The user's prompt or the assistant's response explicitly states the convention.

If no such learning is present, return:
{"learning": null}

If a learning is present, return:
{"learning": {"node_path": "<repo-relative folder ending in '/'>", "insight": "<one sentence stating the convention>"}}

Rules for the JSON:
- "node_path" must be a folder path with a trailing slash, e.g. "src/api/webhooks/". If unsure, use the most specific folder mentioned in the turn, or "src/" as a fallback. Never invent a path that wasn't referenced.
- "insight" must be a single declarative sentence in the team's voice ("Use exponential backoff with jitter for webhook retries.").
- No code fences, no prose, no explanation outside the JSON.

Default to {"learning": null}. Wiki spam is worse than a missed learning.`;

// Robust parser: the model occasionally wraps JSON in markdown fences or adds
// a leading "Here is the JSON:". Strip anything before the first '{' and after
// the last matching '}'. Returns { learning: null } on any malformed shape.
export function parseExtractResponse(raw) {
  if (typeof raw !== 'string') return { learning: null };
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { learning: null };
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { learning: null };
  }
  if (!parsed || typeof parsed !== 'object') return { learning: null };
  const l = parsed.learning;
  if (!l || typeof l !== 'object') return { learning: null };
  if (typeof l.node_path !== 'string' || typeof l.insight !== 'string') {
    return { learning: null };
  }
  const node_path = l.node_path.trim();
  const insight = l.insight.trim();
  if (!node_path || !insight) return { learning: null };
  // Enforce trailing slash convention (roadmap §3) — caller can trust it.
  const normalizedPath = node_path.endsWith('/') ? node_path : `${node_path}/`;
  return { learning: { node_path: normalizedPath, insight } };
}

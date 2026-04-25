// Shared normalization for `learnings.body_normalized`. The MCP tool, the
// Stop hook, and `/wiki/propose` MUST use this same function so dedup keys
// agree across paths (Person C roadmap §3 calls this load-bearing).
//
// Rule: lowercase, collapse non-alphanumerics into single spaces, trim.
// Exact-match dedup; no embeddings. Spec §3 / §7.

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Path normalization: every `nodes.path` is stored with a trailing slash
// (`'src/api/auth/'`, never `'src/api/auth'`). Person C roadmap §3.
export function normalizePath(p: string): string {
  let out = p.trim();
  if (out === '') return '';
  if (!out.endsWith('/')) out = out + '/';
  return out;
}

// All proper ancestors of a file path (or a folder path), ordered shallow → deep.
// `'src/api/auth/login.ts'` -> ['', 'src/', 'src/api/', 'src/api/auth/'].
// Folder paths get their own self-prefix walk too: `'src/api/auth/'` -> same list.
export function ancestorPaths(filePath: string): string[] {
  const segments = filePath.split('/').filter((s) => s !== '');
  const out: string[] = [''];
  let acc = '';
  // If the input is a folder (trailing slash), drop the last segment from the walk
  // because we want strict ancestors of the *thing*, including the thing itself if
  // it's a folder. The HCL spec wants nodes whose path is a prefix of the target,
  // so we include all incremental prefixes of the segment list.
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i] + '/';
    out.push(acc);
  }
  return out;
}

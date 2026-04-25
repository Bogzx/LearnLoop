// Path helpers for the wiki tree. Co-located with normalize() because they
// share the trailing-slash invariant: every nodes.path stored in Postgres
// ends in '/' (roadmap §3), and ancestor walks rely on prefix matching
// against those slash-terminated keys.

// Normalize a folder path to the trailing-slash convention. Used by
// /wiki/propose before upserting a node, and by anything that takes raw
// user input (MCP tool, hook payload) and resolves it to a node row.
//
// Empty string passes through unchanged so the synthetic root node ('')
// stays distinct from a single slash.
export function normalizePath(p) {
  let out = String(p || '').trim();
  if (out === '') return '';
  if (!out.endsWith('/')) out = out + '/';
  return out;
}

// All inclusive ancestor paths of a file (or folder) path, ordered shallow
// → deep. Used by /context's HCL bundle and /examples's reuse ranking.
//
// Examples:
//   ancestorPaths('src/api/webhooks/handler.ts')
//     -> ['', 'src/', 'src/api/', 'src/api/webhooks/']
//   ancestorPaths('src/api/webhooks/')
//     -> ['', 'src/', 'src/api/', 'src/api/webhooks/']
//   ancestorPaths('')
//     -> ['']
//
// The synthetic root node '' is always included so team-wide rules
// (stored on the root node) layer in.
export function ancestorPaths(filePath) {
  const segments = String(filePath || '')
    .split('/')
    .filter((s) => s !== '');
  const out = [''];
  let acc = '';
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i] + '/';
    out.push(acc);
  }
  return out;
}

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
//     -> ['', 'src/', 'src/api/', 'src/api/webhooks/', 'src/api/webhooks/handler.ts']
//   ancestorPaths('src/api/webhooks/')
//     -> ['', 'src/', 'src/api/', 'src/api/webhooks/']
//   ancestorPaths('')
//     -> ['']
//
// The synthetic root node '' is always included so team-wide rules
// (stored on the root node) layer in. The file path itself is appended as
// the deepest ancestor when the input is file-shaped (no trailing slash);
// folder-shaped inputs are unchanged. Per-file wiki nodes (introduced by
// the 2026-04-26 rich-bootstrap rollout) need this so the prompt coach
// surfaces a file's own page when the user is editing that file.
export function ancestorPaths(filePath) {
  const raw = String(filePath || '');
  const segments = raw.split('/').filter((s) => s !== '');
  const isFileShaped = segments.length > 0 && !raw.endsWith('/');
  // Folder ancestors: when input is file-shaped, only the parent segments
  // become folder-ified (the file's own segment is NOT a folder). When
  // input is folder-shaped, every segment is folder-ified. Pre-2026-04-26
  // this loop ran over all segments unconditionally — for file inputs it
  // appended a bogus 'src/.../handler.ts/' entry that never matched a
  // node row but bloated the IN-list.
  const folderCount = isFileShaped ? segments.length - 1 : segments.length;
  const out = [''];
  let acc = '';
  for (let i = 0; i < folderCount; i++) {
    acc += segments[i] + '/';
    out.push(acc);
  }
  // File-shaped input: append the file path itself as the deepest ancestor.
  // Per-file wiki nodes (rich-bootstrap rollout) live at this exact key.
  if (isFileShaped) {
    out.push(segments.join('/'));
  }
  return out;
}

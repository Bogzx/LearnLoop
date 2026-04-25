// Pure path helpers — no vscode imports, so unit-testable from Node directly.
//
// Trim the file portion of a relative path; ensure trailing slash. Empty
// input → "". Used to derive node_path from an active editor URI.
export function toFolderPath(rel: string): string {
  if (!rel) return '';
  const s = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const lastSlash = s.lastIndexOf('/');
  if (lastSlash === -1) return '';
  return s.slice(0, lastSlash + 1);
}

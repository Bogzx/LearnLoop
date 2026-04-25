// Helpers for deriving folder paths from active editor URIs. Spec §3 invariant:
// node_path is always "src/api/auth/" with a trailing slash; never the file
// itself, never a leading slash.
import * as vscode from 'vscode';
import { toFolderPath } from './paths-pure.ts';

export { toFolderPath };

// Derive the directory portion of the active file relative to the workspace
// root, with a trailing slash. Returns null if no editor is active or the
// file is outside any workspace folder.
export function activeFolderPath(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const uri = editor.document.uri;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return null;
  const rel = vscode.workspace.asRelativePath(uri, false);
  return toFolderPath(rel);
}

// Derive the file path relative to the workspace root. Used by /score for
// `file_path` context. Returns null if not in a workspace.
export function activeFilePath(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const uri = editor.document.uri;
  if (!vscode.workspace.getWorkspaceFolder(uri)) return null;
  return vscode.workspace.asRelativePath(uri, false);
}


# vscode-ext — VS Code extension

The IDE-side coaching surface. Sidebar webview with score-card, team-anchored
examples, articulation scaffold, and the wiki-update toast that closes the
autonomous demo loop.

**Tech:** TypeScript + VS Code API + WebView for sidebar.

**Surfaces (spec §7 A):**
- Sidebar webview — same score-card UI as browser-ext
- Pre-prompt panel — 2-3 team-anchored examples for current file path
- `Cmd+Shift+K` — articulation scaffold (3-field thinking helper)
- Post-prompt outcome rating widget (one keystroke)
- Polls `/wiki/propose` results → toast + wiki view refresh
  (this is what makes the autonomous demo moment audience-visible
  when Claude Code calls the MCP tool)

**Talks to:** `apps/api` only (HTTP + polling).

**Spec refs:** §7 A, §13 (1:40–2:50 demo beats)

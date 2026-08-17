# vscode-ext — VS Code extension

The IDE-side coaching surface. Sidebar webview with score-card, team-anchored
examples, and the wiki-update toast.

**Tech:** TypeScript + VS Code API + WebView for sidebar.

**Actually implemented:**
- Sidebar webview (`trailhead.coach`, in the Trailhead activity-bar container)
  — same score-card UI as browser-ext
- Team-anchored examples for the current file path
- Outcome rating widget (`src/outcome-rating.ts`)
- Polls `/wiki/recent` → toast + wiki view refresh (`src/wiki-diff.ts`)
- One command: `trailhead.refresh` ("Trailhead: Refresh sidebar")

**Specced but never built:**
- The `Cmd+Shift+K` articulation scaffold (the 3-field thinking helper). It was
  deferred during the original build and never picked up. The manifest
  contributes no keybindings at all, so the shortcut does nothing.

**Talks to:** `apps/api` only (HTTP + polling).

**Spec refs:** §7 A, §13 (1:40–2:50 demo beats)

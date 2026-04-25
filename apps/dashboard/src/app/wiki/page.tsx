// /wiki — the Karpathy-flavored file-tree wiki view (master spec §17 #5).
// Static reference page during the demo; one of the supporting beats that
// shows there's a real, growing curriculum behind the score-card pedagogy.

import { WikiTree } from '@/components/wiki-tree';

export default function WikiPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Wiki</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          The team's growing curriculum. Path-organized rules and durable
          learnings — promoted from drafts after 3+ reinforcements via the
          MCP tool or the autonomous Stop hook.
        </p>
      </header>

      <WikiTree />
    </section>
  );
}

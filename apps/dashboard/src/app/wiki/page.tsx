// /wiki — the Karpathy-flavored file-tree wiki view (master spec §17 #5).
// Shows the team this dashboard is configured for (TRAILHEAD_TEAM_TOKEN,
// server-side); data comes through the read-only /api/trailhead proxy.

import Link from 'next/link';
import { WikiTree } from '@/components/wiki-tree';

export default function WikiPage() {
  return (
    <section className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Teams
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Team&apos;s knowledge</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          The team&apos;s growing curriculum. Path-organized rules and durable
          learnings — promoted from drafts after 3+ reinforcements via the
          MCP tool.
        </p>
      </header>

      <WikiTree />
    </section>
  );
}

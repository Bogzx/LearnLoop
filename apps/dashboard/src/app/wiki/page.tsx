// /wiki — the Karpathy-flavored file-tree wiki view (master spec §17 #5).
// Reads the team token from `?team=<token>` (set by the team picker on
// the home page); falls back to the demo token when no param is given.

import Link from 'next/link';
import { WikiTree } from '@/components/wiki-tree';
import { DEFAULT_TEAM_TOKEN } from '@/lib/api';

export default function WikiPage({
  searchParams,
}: {
  searchParams: { team?: string };
}) {
  const token = searchParams.team ?? DEFAULT_TEAM_TOKEN;

  return (
    <section className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Teams
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Team's knowledge</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          The team's growing curriculum. Path-organized rules and durable
          learnings — promoted from drafts after 3+ reinforcements via the
          MCP tool.
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
          token: {token}
        </p>
      </header>

      <WikiTree token={token} />
    </section>
  );
}

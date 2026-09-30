// /onboarding — new-teammate landing. Surfaces the team's most-appreciated
// graduated prompts and durable patterns, sourced from /wiki/tree (no new
// API endpoint needed). Mirrors the team/skill-arc/wiki page shell.

import Link from 'next/link';
import { OnboardingView } from '@/components/onboarding-view';

export default function OnboardingPage() {
  return (
    <section className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Teams
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Onboarding</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          New to the team? Start here. The prompts the team reuses most and the
          patterns that have stuck — distilled from real usage, no docs to read.
        </p>
      </header>

      <OnboardingView />
    </section>
  );
}

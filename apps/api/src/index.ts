// trailhead-api entry point: check env, apply the startup migrations, serve.
// The routes live in app.ts so tests can exercise them without a listener.
import './env.ts';
import { serve } from '@hono/node-server';
import { llmConfigError, llmMode } from './llm-mode.ts';
import { demoTeamConfigError } from './demo-team.ts';

// Checked before app.ts is imported: its modules open the pg pool at load time
// and would otherwise die with a less useful error.
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const llmError = llmConfigError();
if (llmError) { console.error(llmError); process.exit(1); }
const demoTeamError = demoTeamConfigError();
if (demoTeamError) { console.error(demoTeamError); process.exit(1); }
if (llmMode() === 'offline') {
  console.warn(
    '[llm] TRAILHEAD_LLM=offline: no model. Prompts are scored by the rule-based scorer ' +
      '(packages/scoring/src/heuristic-score.mjs), coaching uses the static templates, and the ' +
      'rich wiki bootstrap is disabled. Every /score and /coach response says so.',
  );
}

const { app, ensureRecentMigrations } = await import('./app.ts');
const { countLegacyTeams, failInterruptedJobs, pool } = await import('./db.ts');
const { shutdownLangfuse } = await import('./langfuse.ts');

// Legacy tokens default on so pre-2026-09-30 installs keep working, which
// means every legacy team is open to anyone who can derive its token from the
// repo URL. Say so once at startup, with the count, rather than only when a
// legacy token is first used.
async function warnAboutLegacyTeams(): Promise<void> {
  if (process.env.TRAILHEAD_ACCEPT_LEGACY_TOKENS === 'false') return;
  const n = await countLegacyTeams();
  if (!n) return;
  console.warn(
    `[auth] ${n} legacy team(s) still authenticate with their id (repo_… = sha256 of the git remote URL) ` +
      'because TRAILHEAD_ACCEPT_LEGACY_TOKENS is on. Anyone who knows such a repo URL can read, write and wipe ' +
      'that team, or rotate its secret and lock the team out. Run `init --upgrade-legacy` in each repo, then ' +
      'set TRAILHEAD_ACCEPT_LEGACY_TOKENS=false.',
  );
}

const port = Number(process.env.PORT ?? 3000);
let server: ReturnType<typeof serve> | undefined;
ensureRecentMigrations()
  .catch((err) => console.warn('[migrate] startup check failed', err))
  .then(() => failInterruptedJobs())
  .then((n) => {
    if (n) console.warn(`[startup] marked ${n} interrupted bootstrap job(s) as failed`);
  })
  .catch((err) => console.warn('[startup] could not check for interrupted jobs', err))
  .then(() => warnAboutLegacyTeams())
  .catch((err) => console.warn('[startup] could not count legacy teams', err))
  .finally(() => {
    server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`trailhead-api listening on http://localhost:${info.port}`);
    });
  });

// Graceful shutdown (docker stop / Railway redeploy send SIGTERM): stop
// accepting connections, let in-flight requests finish, flush traces, close
// the pool. A second signal, or 10 s, forces the exit.
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`[shutdown] ${sig} — draining`);
    setTimeout(() => process.exit(1), 10_000).unref();
    const closed = new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    void closed
      .then(() => shutdownLangfuse().catch(() => {}))
      .then(() => pool.end().catch(() => {}))
      .finally(() => process.exit(0));
  });
}

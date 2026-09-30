// trailhead-api entry point: check env, apply the startup migrations, serve.
// The routes live in app.ts so tests can exercise them without a listener.
import './env.ts';
import { serve } from '@hono/node-server';

// Checked before app.ts is imported: its modules open the pg pool and the
// Gemini client at load time and would otherwise die with a less useful error.
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const { app, ensureRecentMigrations } = await import('./app.ts');
const { failInterruptedJobs, pool } = await import('./db.ts');
const { shutdownLangfuse } = await import('./langfuse.ts');

const port = Number(process.env.PORT ?? 3000);
let server: ReturnType<typeof serve> | undefined;
ensureRecentMigrations()
  .catch((err) => console.warn('[migrate] startup check failed', err))
  .then(() => failInterruptedJobs())
  .then((n) => {
    if (n) console.warn(`[startup] marked ${n} interrupted bootstrap job(s) as failed`);
  })
  .catch((err) => console.warn('[startup] could not check for interrupted jobs', err))
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

// trailhead-api entry point: check env, apply the startup migrations, serve.
// The routes live in app.ts so tests can exercise them without a listener.
import './env.ts';
import { serve } from '@hono/node-server';

// Checked before app.ts is imported: its modules open the pg pool and the
// Gemini client at load time and would otherwise die with a less useful error.
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const { app, ensureRecentMigrations } = await import('./app.ts');
const { shutdownLangfuse } = await import('./langfuse.ts');

const port = Number(process.env.PORT ?? 3000);
ensureRecentMigrations()
  .catch((err) => console.warn('[migrate] startup check failed', err))
  .finally(() => {
    serve({ fetch: app.fetch, port }, (info) => {
      console.log(`trailhead-api listening on http://localhost:${info.port}`);
    });
  });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await shutdownLangfuse().catch(() => {});
    process.exit(0);
  });
}

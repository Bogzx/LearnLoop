import { AsyncLocalStorage } from 'node:async_hooks';
import { Langfuse, type LangfuseTraceClient } from 'langfuse';

const enabled =
  !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;

export const langfuse = enabled
  ? new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com',
      flushAt: 1,
    })
  : null;

if (!enabled) {
  console.warn('[langfuse] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled');
}

const traceStore = new AsyncLocalStorage<LangfuseTraceClient | undefined>();

export function withTrace<T>(
  trace: LangfuseTraceClient | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return traceStore.run(trace, fn);
}

export function currentTrace(): LangfuseTraceClient | undefined {
  return traceStore.getStore();
}

export async function shutdownLangfuse(): Promise<void> {
  if (langfuse) await langfuse.shutdownAsync();
}

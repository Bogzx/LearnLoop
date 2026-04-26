// `npm run try -- "<prompt>"` — single-prompt replay against Gemini-Flash.
//
// Loads .env from the repo root automatically. Prints the picked tool,
// the args, and the latency. Use --verbose to also print the directive
// text the model received.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPrompt } from './run.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up until we find a .env, mimicking smoke-test.mjs.
for (const candidate of ['../../../../.env', '../../../.env', '../../.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const promptArgs = args.filter((a) => !a.startsWith('--'));
const prompt = promptArgs.join(' ').trim();

if (!prompt) {
  console.error('Usage: npm run try -- "<prompt>"');
  console.error('Example: npm run try -- "fix the webhook handler"');
  process.exit(2);
}

console.error(`[harness] model: ${process.env.HARNESS_MODEL ?? 'gemini-3-flash-preview'}`);
console.error(`[harness] prompt: ${prompt}`);
console.error('');

try {
  const result = await runPrompt(prompt);
  if (result.tool) {
    console.log(`→ model picked: ${result.tool}`);
    console.log(`   args: ${JSON.stringify(result.args, null, 2)}`);
  } else {
    console.log('→ model picked: <no tool — answered with text>');
    if (result.text) {
      console.log(`   text: ${result.text.slice(0, 200)}${result.text.length > 200 ? '…' : ''}`);
    }
  }
  console.log('');
  console.log(`[harness] latency: ${result.latencyMs}ms`);
  if (verbose) {
    console.log('');
    console.log('[harness] system instruction (directive):');
    const { COACHING_DIRECTIVE_TEXT } = await import('../directive.ts');
    console.log(COACHING_DIRECTIVE_TEXT);
  }
} catch (e) {
  console.error(`[harness] error: ${(e as Error).message}`);
  process.exit(1);
}

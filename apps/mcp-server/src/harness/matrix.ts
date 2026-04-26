// `npm run try:matrix` — runs every prompt in matrix.json against Gemini-Flash
// and prints a pass/fail table. The matrix list is the demo script — if all
// rows pass, the demo will land. Pre-commit gate.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPrompt } from './run.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const candidate of ['../../../../.env', '../../../.env', '../../.env']) {
  const p = resolve(__dirname, candidate);
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

interface MatrixEntry {
  prompt: string;
  expected: string;
  why?: string;
}

const matrix: MatrixEntry[] = JSON.parse(
  readFileSync(resolve(__dirname, 'matrix.json'), 'utf8'),
);

const pad = (s: string, n: number): string =>
  s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length);

console.error(`[harness] running ${matrix.length} matrix prompts`);
console.error(`[harness] model: ${process.env.HARNESS_MODEL ?? 'gemini-3-flash-preview'}`);
console.error('');

const header = pad('prompt', 56) + pad('expected', 14) + pad('actual', 14) + 'ok';
console.log(header);
console.log('─'.repeat(header.length));

let pass = 0;
let fail = 0;
const failures: { row: MatrixEntry; actual: string | null }[] = [];

for (const row of matrix) {
  let actual: string | null = null;
  let err: string | null = null;
  try {
    const r = await runPrompt(row.prompt);
    actual = r.tool;
  } catch (e) {
    err = (e as Error).message;
  }

  const ok = actual === row.expected;
  if (ok) pass++;
  else {
    fail++;
    failures.push({ row, actual });
  }

  const actualLabel = err ? `ERR: ${err.slice(0, 8)}` : (actual ?? '<text>');
  const mark = ok ? '✓' : '✗';
  console.log(
    pad(row.prompt, 56) + pad(row.expected, 14) + pad(actualLabel, 14) + mark,
  );
}

console.log('─'.repeat(header.length));
console.log(`${pass}/${matrix.length} passed${fail ? `, ${fail} failed` : ''}`);

if (failures.length) {
  console.log('');
  console.log('failure details:');
  for (const f of failures) {
    console.log(`  prompt:   ${f.row.prompt}`);
    console.log(`  expected: ${f.row.expected}`);
    console.log(`  actual:   ${f.actual ?? '<no tool>'}`);
    if (f.row.why) console.log(`  why:      ${f.row.why}`);
    console.log('');
  }
  process.exit(1);
}

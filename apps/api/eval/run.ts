// Scoring eval harness: score every golden prompt N times with the real
// scorer and report the spread. See eval/README.md.
//
//   npm --workspace=apps/api run eval -- --dry-run            # offline, free
//   npm --workspace=apps/api run eval -- --scorer heuristic --runs 1  # rule-based baseline, free
//   GEMINI_API_KEY=… npm --workspace=apps/api run eval -- --yes --runs 5
//   … --temperature 0 --thinking-budget 512 --label t0-b512  # compare settings
//
// A Gemini run makes (prompts × runs) paid calls, so it refuses to start
// without --yes and prints the call count first. CI never runs it; CI does run
// the rule-based scorer over the golden and held-out sets (baseline.test.ts).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DimensionScores } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';
import { HEURISTIC_SCORER, heuristicScore } from '@trailhead/scoring';
import {
  buildReport,
  renderMarkdown,
  reportPrompt,
  validateGoldenSet,
  type GoldenPrompt,
  type RunResult,
} from './stats.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Args {
  scorer: 'gemini' | 'heuristic';
  runs: number;
  yes: boolean;
  dryRun: boolean;
  only: string[] | null;
  temperature?: number;
  thinkingBudget?: number;
  label: string;
  out: string;
  golden: string;
  delayMs: number;
}

export function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    if (i !== -1 && i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    return eq ? eq.slice(name.length + 1) : undefined;
  };
  const num = (name: string) => {
    const v = get(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got ${v})`);
    return n;
  };
  const scorer = get('--scorer') ?? 'gemini';
  if (scorer !== 'gemini' && scorer !== 'heuristic') throw new Error('--scorer must be gemini or heuristic');
  const runs = num('--runs') ?? 5;
  if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error('--runs must be an integer in 1..50');
  return {
    scorer,
    runs,
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    only: get('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
    temperature: num('--temperature'),
    thinkingBudget: num('--thinking-budget'),
    label: get('--label') ?? 'default',
    out: resolve(get('--out') ?? resolve(HERE, 'results')),
    golden: resolve(get('--golden') ?? resolve(HERE, 'golden.json')),
    delayMs: num('--delay-ms') ?? 0,
  };
}

// Deterministic-per-seed fake scorer for --dry-run: centred on the golden
// bands with ±1 noise, so the whole pipeline (stats, gates, report) runs
// without a key. The numbers mean nothing.
function fakeScorer(golden: GoldenPrompt[]) {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const byPrompt = new Map(golden.map((g) => [g.prompt, g]));
  return async ({ prompt }: { prompt: string }) => {
    const g = byPrompt.get(prompt)!;
    const centre = (g.overall[0] + g.overall[1]) / 2;
    const dims = Object.fromEntries(
      DIMENSIONS.map((d) => {
        const b = g.dims?.[d];
        const c = b ? (b[0] + b[1]) / 2 : centre;
        return [d, Math.max(0, Math.min(10, Math.round(c + (rand() * 2 - 1))))];
      }),
    ) as DimensionScores;
    return { dimensions: dims, missing: {} as Record<string, string> };
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const golden = validateGoldenSet(JSON.parse(readFileSync(args.golden, 'utf8')));
  const prompts = args.only ? golden.prompts.filter((p) => args.only!.includes(p.id)) : golden.prompts;
  if (!prompts.length) throw new Error(`--only matched no prompts (ids: ${golden.prompts.map((p) => p.id).join(', ')})`);
  const calls = prompts.length * args.runs;

  if (args.temperature !== undefined) process.env.TRAILHEAD_SCORE_TEMPERATURE = String(args.temperature);
  if (args.thinkingBudget !== undefined) process.env.TRAILHEAD_SCORE_THINKING_BUDGET = String(args.thinkingBudget);

  let scorer: (a: { prompt: string }) => Promise<{ dimensions: DimensionScores; missing: Record<string, string> }>;
  let model = 'fake (dry run)';
  let sampling = { temperature: args.temperature ?? NaN, thinkingBudget: args.thinkingBudget ?? NaN };

  if (args.dryRun) {
    scorer = fakeScorer(prompts);
  } else if (args.scorer === 'heuristic') {
    // Deterministic and free: no key, no --yes. One run per prompt is enough.
    scorer = async ({ prompt }) => heuristicScore(prompt);
    model = `${HEURISTIC_SCORER} (rule-based, no model)`;
  } else {
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is not set. Use --dry-run to exercise the harness without a key.');
      return 2;
    }
    if (!args.yes) {
      console.error(
        `This would make ${calls} Gemini calls (${prompts.length} prompts × ${args.runs} runs) billed to GEMINI_API_KEY.\n` +
          'Re-run with --yes to proceed, or --dry-run to test the harness for free.',
      );
      return 2;
    }
    const gemini = await import('../src/gemini.ts');
    const { SCORE_MODEL } = await import('@trailhead/scoring');
    scorer = gemini.scorePrompt;
    model = SCORE_MODEL;
    sampling = gemini.scoreSamplingConfig();
  }

  console.error(`${args.dryRun ? '[dry run] ' : ''}${calls} scoring calls: ${prompts.length} prompts × ${args.runs} runs`);
  const reports = [];
  for (const g of prompts) {
    const runs: RunResult[] = [];
    for (let i = 0; i < args.runs; i++) {
      try {
        const r = await scorer({ prompt: g.prompt });
        const unparseable = DIMENSIONS.every((d) => r.dimensions[d] === 0) && Object.keys(r.missing).length === 0;
        runs.push(unparseable ? { dimensions: null, failed: 'unparseable' } : { dimensions: r.dimensions });
      } catch (err) {
        runs.push({ dimensions: null, failed: String((err as Error).message ?? err).slice(0, 200) });
      }
      if (args.delayMs) await new Promise((r) => setTimeout(r, args.delayMs));
    }
    const rep = reportPrompt(g, runs);
    reports.push(rep);
    console.error(`  ${g.id.padEnd(22)} overall ${rep.overall.min}–${rep.overall.max} (sd ${rep.overall.sd.toFixed(2)})${rep.failures ? `, ${rep.failures} failed` : ''}`);
  }

  const startedAt = new Date().toISOString();
  const report = buildReport(
    { model, runsPerPrompt: args.runs, temperature: sampling.temperature, thinkingBudget: sampling.thinkingBudget, label: args.label, startedAt, dryRun: args.dryRun },
    reports,
  );
  mkdirSync(args.out, { recursive: true });
  const base = resolve(args.out, `${startedAt.replace(/[:.]/g, '-')}-${args.label.replace(/[^\w.-]/g, '_')}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, renderMarkdown(report));
  console.error(`\nwrote ${base}.md and .json`);
  process.stdout.write(renderMarkdown(report));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}

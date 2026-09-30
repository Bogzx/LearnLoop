// Pure statistics + report rendering for the scoring eval harness (run.ts).
// No I/O, no model calls — unit-tested in stats.test.ts.

import type { Dimension, DimensionScores } from '@trailhead/shared';
import { DIMENSIONS } from '@trailhead/shared';

export type Band = [number, number];

export interface GoldenPrompt {
  id: string;
  prompt: string;
  overall: Band;
  dims?: Partial<Record<Dimension, Band>>;
}

export interface GoldenSet {
  prompts: GoldenPrompt[];
}

/** Throws with every problem at once — a malformed golden set should never
 *  cost a paid run to discover. */
export function validateGoldenSet(input: unknown): GoldenSet {
  const problems: string[] = [];
  const set = input as GoldenSet;
  if (!set || !Array.isArray(set.prompts) || set.prompts.length === 0) {
    throw new Error('golden set: `prompts` must be a non-empty array');
  }
  const ids = new Set<string>();
  const band = (b: unknown, where: string) => {
    if (!Array.isArray(b) || b.length !== 2 || !b.every((n) => Number.isInteger(n) && n >= 0 && n <= 10) || b[0] > b[1]) {
      problems.push(`${where}: band must be [min, max] integers in 0..10 with min <= max`);
    }
  };
  for (const [i, p] of set.prompts.entries()) {
    const where = `prompts[${i}]${p?.id ? ` (${p.id})` : ''}`;
    if (!p || typeof p.id !== 'string' || !p.id) problems.push(`${where}: missing id`);
    else if (ids.has(p.id)) problems.push(`${where}: duplicate id`);
    else ids.add(p.id);
    if (typeof p?.prompt !== 'string' || !p.prompt.trim()) problems.push(`${where}: missing prompt`);
    band(p?.overall, `${where}.overall`);
    for (const [k, b] of Object.entries(p?.dims ?? {})) {
      if (!(DIMENSIONS as readonly string[]).includes(k)) problems.push(`${where}.dims: unknown dimension ${k}`);
      band(b, `${where}.dims.${k}`);
    }
  }
  if (problems.length) throw new Error(`golden set invalid:\n  ${problems.join('\n  ')}`);
  return set;
}

export interface Summary {
  n: number;
  mean: number;
  sd: number; // population standard deviation
  min: number;
  max: number;
}

export function summarize(values: number[]): Summary {
  const n = values.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  return { n, mean, sd, min: Math.min(...values), max: Math.max(...values) };
}

export const inBand = (v: number, [lo, hi]: Band) => v >= lo && v <= hi;

/** One scoring call's outcome. `failed` = threw or returned the unparseable
 *  fingerprint; such runs are counted but excluded from the stats. */
export interface RunResult {
  dimensions: DimensionScores | null;
  failed?: string;
}

const round = (d: DimensionScores) => Math.round(DIMENSIONS.reduce((s, k) => s + d[k], 0) / DIMENSIONS.length);
const exactMean = (d: DimensionScores) => DIMENSIONS.reduce((s, k) => s + d[k], 0) / DIMENSIONS.length;
const promotable = (d: DimensionScores) => exactMean(d) >= 7 && DIMENSIONS.every((k) => d[k] >= 5);

export interface PromptReport {
  id: string;
  runs: number;
  failures: number;
  overall: Summary;
  dims: Record<Dimension, Summary>;
  /** Share of successful runs whose rounded overall is inside the expected band. */
  overallBandHit: number;
  /** Share of (run × banded dimension) pairs inside their band; NaN if no dim bands. */
  dimBandHit: number;
  /** Runs disagreed on "skip coaching" (rounded overall >= 7). */
  coachingGateFlips: boolean;
  /** Runs disagreed on the library promotion gate (exact mean >= 7, no dim < 5). */
  promotionGateFlips: boolean;
}

export function reportPrompt(golden: GoldenPrompt, runs: RunResult[]): PromptReport {
  const ok = runs.filter((r): r is { dimensions: DimensionScores } => r.dimensions !== null && !r.failed);
  const overallValues = ok.map((r) => round(r.dimensions));
  const dims = Object.fromEntries(
    DIMENSIONS.map((d) => [d, summarize(ok.map((r) => r.dimensions[d]))]),
  ) as Record<Dimension, Summary>;
  let dimChecks = 0;
  let dimHits = 0;
  for (const r of ok) {
    for (const [d, b] of Object.entries(golden.dims ?? {}) as [Dimension, Band][]) {
      dimChecks++;
      if (inBand(r.dimensions[d], b)) dimHits++;
    }
  }
  const coach = new Set(overallValues.map((v) => v >= 7));
  const promo = new Set(ok.map((r) => promotable(r.dimensions)));
  return {
    id: golden.id,
    runs: runs.length,
    failures: runs.length - ok.length,
    overall: summarize(overallValues),
    dims,
    overallBandHit: ok.length ? overallValues.filter((v) => inBand(v, golden.overall)).length / ok.length : NaN,
    dimBandHit: dimChecks ? dimHits / dimChecks : NaN,
    coachingGateFlips: coach.size > 1,
    promotionGateFlips: promo.size > 1,
  };
}

export interface EvalConfig {
  model: string;
  runsPerPrompt: number;
  temperature: number;
  thinkingBudget: number;
  label: string;
  startedAt: string;
  dryRun: boolean;
}

export interface EvalReport {
  config: EvalConfig;
  prompts: PromptReport[];
  totals: {
    calls: number;
    failures: number;
    meanOverallSd: number;
    meanDimSd: Record<Dimension, number>;
    /** Prompts whose rounded overall spans >= 2 points across runs. */
    unstablePrompts: string[];
    overallBandHit: number;
    dimBandHit: number;
    coachingGateFlipRate: number;
    promotionGateFlipRate: number;
  };
}

const avg = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};

export function buildReport(config: EvalConfig, prompts: PromptReport[]): EvalReport {
  return {
    config,
    prompts,
    totals: {
      calls: prompts.reduce((s, p) => s + p.runs, 0),
      failures: prompts.reduce((s, p) => s + p.failures, 0),
      meanOverallSd: avg(prompts.map((p) => p.overall.sd)),
      meanDimSd: Object.fromEntries(DIMENSIONS.map((d) => [d, avg(prompts.map((p) => p.dims[d].sd))])) as Record<Dimension, number>,
      unstablePrompts: prompts.filter((p) => p.overall.max - p.overall.min >= 2).map((p) => p.id),
      overallBandHit: avg(prompts.map((p) => p.overallBandHit)),
      dimBandHit: avg(prompts.map((p) => p.dimBandHit)),
      coachingGateFlipRate: prompts.length ? prompts.filter((p) => p.coachingGateFlips).length / prompts.length : NaN,
      promotionGateFlipRate: prompts.length ? prompts.filter((p) => p.promotionGateFlips).length / prompts.length : NaN,
    },
  };
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');

export function renderMarkdown(r: EvalReport): string {
  const c = r.config;
  const t = r.totals;
  const short: Record<Dimension, string> = {
    goal_clarity: 'goal',
    specificity: 'spec',
    context_loading: 'ctx',
    constraint_articulation: 'cons',
    output_specification: 'out',
  };
  const lines = [
    `# Scoring eval — ${c.label}`,
    '',
    `${c.dryRun ? '**DRY RUN — fake scorer, no model calls; numbers are meaningless.**\n\n' : ''}` +
      `Model \`${c.model}\` · temperature ${Number.isFinite(c.temperature) ? c.temperature : '—'} · ` +
      `thinking budget ${Number.isFinite(c.thinkingBudget) ? c.thinkingBudget : '—'} · ` +
      `${c.runsPerPrompt} runs × ${r.prompts.length} prompts = ${t.calls} calls (${t.failures} failed) · ${c.startedAt}`,
    '',
    '## Summary',
    '',
    '| metric | value |',
    '|---|---|',
    `| mean SD of overall across runs | ${f2(t.meanOverallSd)} |`,
    `| mean SD per dimension | ${DIMENSIONS.map((d) => `${short[d]} ${f2(t.meanDimSd[d])}`).join(' · ')} |`,
    `| prompts whose overall spans ≥ 2 points | ${t.unstablePrompts.length}${t.unstablePrompts.length ? ` (${t.unstablePrompts.join(', ')})` : ''} |`,
    `| coaching gate flips (runs disagree on overall ≥ 7) | ${pct(t.coachingGateFlipRate)} of prompts |`,
    `| promotion gate flips (runs disagree on library eligibility) | ${pct(t.promotionGateFlipRate)} of prompts |`,
    `| overall inside expected band | ${pct(t.overallBandHit)} of runs |`,
    `| dimensions inside expected band | ${pct(t.dimBandHit)} of checks |`,
    '',
    '## Per prompt',
    '',
    `| id | overall mean ± SD | min–max | band hit | ${DIMENSIONS.map((d) => `${short[d]} SD`).join(' | ')} | gate flips | fails |`,
    `|---|---|---|---|${DIMENSIONS.map(() => '---').join('|')}|---|---|`,
    ...r.prompts.map((p) =>
      `| ${p.id} | ${f1(p.overall.mean)} ± ${f2(p.overall.sd)} | ${p.overall.min}–${p.overall.max} | ${pct(p.overallBandHit)} | ` +
        `${DIMENSIONS.map((d) => f2(p.dims[d].sd)).join(' | ')} | ` +
        `${[p.coachingGateFlips ? 'coach' : '', p.promotionGateFlips ? 'library' : ''].filter(Boolean).join(', ') || '—'} | ${p.failures} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

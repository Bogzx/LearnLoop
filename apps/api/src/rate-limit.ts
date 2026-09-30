// In-process token-bucket rate limiting.
//
// Why: POST /teams is unauthenticated (open registration by default), and
// every call to /score, /coach, /improve, /diff and /onboard/repo/full spends
// the operator's Gemini quota. Without limits, one client — a buggy loop or
// a stranger who can reach the port — can burn the whole quota or fill the
// teams table.
//
// Limitation: buckets live in this process's memory. With several API
// replicas each enforces its own limit (the effective limit is N×), and a
// restart resets them. That fits the self-hosted single-container setup; a
// multi-replica deploy needs a shared store (Redis) — see SELFHOSTING.md.
//
// Configuration (all optional; "N/<window>" with window s | m | h, e.g.
// "120/1m", "10/1h"; "off" disables that limit; TRAILHEAD_RATE_LIMIT=off
// disables all of them):
//   TRAILHEAD_RL_REGISTER_PER_IP   POST /teams, per client IP        (10/1h)
//   TRAILHEAD_RL_LLM_PER_TEAM      Gemini-backed routes, per team    (120/1m)
//   TRAILHEAD_RL_LLM_PER_IP        Gemini-backed routes, per IP      (120/1m)
//   TRAILHEAD_RL_BOOTSTRAP_PER_TEAM POST /onboard/repo/full, per team (6/1h)
// A limit of "N/W" allows a burst of N and refills continuously at N per W.

import { isIPv6 } from 'node:net';

export interface LimitSpec {
  capacity: number;
  refillPerMs: number;
  /** Original spec string, for messages and cache keys. */
  text: string;
}

const WINDOW_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

/** Parse "N/W", "N/Ws|m|h" (W defaults to 1). Returns null for "off"/"0". */
export function parseLimit(text: string): LimitSpec | null {
  const t = text.trim().toLowerCase();
  if (t === 'off' || t === '0' || t === 'none') return null;
  const m = t.match(/^(\d+)\s*\/\s*(\d*)\s*(s|m|h)$/);
  if (!m) throw new Error(`invalid rate limit "${text}" — expected e.g. "120/1m", "10/1h" or "off"`);
  const capacity = Number(m[1]);
  const windowMs = (m[2] ? Number(m[2]) : 1) * WINDOW_MS[m[3]!]!;
  if (capacity < 1 || windowMs <= 0) throw new Error(`invalid rate limit "${text}"`);
  return { capacity, refillPerMs: capacity / windowMs, text: t };
}

export interface TakeResult {
  ok: boolean;
  /** Whole seconds until one token is available (0 when ok). */
  retryAfterSec: number;
  remaining: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

// Memory bound: at most maxKeys buckets. Pruning only removes buckets that
// have refilled completely, which under a flood of fresh keys (one per
// request) is none of them, so when pruning doesn't get below the cap the
// least recently used buckets are evicted down to 90% of it. Evicting a
// bucket forgets that client's debt: under such a flood the limit fails open
// for the oldest clients, rather than memory and per-request cost growing
// without bound. The 10% headroom means the O(n) prune runs at most once per
// maxKeys/10 new keys, not on every request.
export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  private ops = 0;

  constructor(
    readonly spec: LimitSpec,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  take(key: string, cost = 1): TakeResult {
    const t = this.now();
    const { capacity, refillPerMs } = this.spec;
    const prev = this.buckets.get(key);
    const tokens = prev ? Math.min(capacity, prev.tokens + (t - prev.at) * refillPerMs) : capacity;
    if (++this.ops % 1000 === 0) this.prune(t);
    if (!prev && this.buckets.size >= this.maxKeys) this.shrink(t);
    // delete + set moves the key to the end of the Map's insertion order,
    // which is what makes the eviction in shrink() least-recently-used.
    this.buckets.delete(key);
    if (tokens >= cost) {
      this.buckets.set(key, { tokens: tokens - cost, at: t });
      return { ok: true, retryAfterSec: 0, remaining: Math.floor(tokens - cost) };
    }
    this.buckets.set(key, { tokens, at: t });
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cost - tokens) / refillPerMs / 1000)), remaining: 0 };
  }

  private shrink(t: number): void {
    this.prune(t);
    const target = Math.floor(this.maxKeys * 0.9);
    for (const k of this.buckets.keys()) {
      if (this.buckets.size <= target) break;
      this.buckets.delete(k);
    }
  }

  /** Drop buckets that have refilled completely — they carry no state. */
  prune(t = this.now()): void {
    const { capacity, refillPerMs } = this.spec;
    for (const [k, b] of this.buckets) {
      if (b.tokens + (t - b.at) * refillPerMs >= capacity) this.buckets.delete(k);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

// The key a per-IP limit uses for a client address. IPv6 clients are keyed by
// their /64: a single host routinely holds a whole /64 and can use a fresh
// address for every request, which would both skip the limit and grow the
// bucket table by one entry per request. An IPv4-mapped address
// (::ffff:1.2.3.4, what a dual-stack socket reports) is keyed as the IPv4.
export function ipRateKey(ip: string): string {
  const addr = ip.trim().split('%')[0]!; // drop an IPv6 zone id
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1]!;
  if (!isIPv6(addr)) return addr;
  const groups = (part: string) => (part ? part.split(':').flatMap((g) => (g.includes('.') ? ['0', '0'] : [g])) : []);
  const [head, tail] = addr.includes('::') ? addr.split('::') as [string, string] : [addr, undefined];
  const h = groups(head);
  const t = tail === undefined ? [] : groups(tail);
  const all = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${all.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

export type LimitName = 'register_per_ip' | 'llm_per_team' | 'llm_per_ip' | 'bootstrap_per_team';

const ENV: Record<LimitName, { env: string; def: string }> = {
  register_per_ip: { env: 'TRAILHEAD_RL_REGISTER_PER_IP', def: '10/1h' },
  llm_per_team: { env: 'TRAILHEAD_RL_LLM_PER_TEAM', def: '120/1m' },
  llm_per_ip: { env: 'TRAILHEAD_RL_LLM_PER_IP', def: '120/1m' },
  bootstrap_per_team: { env: 'TRAILHEAD_RL_BOOTSTRAP_PER_TEAM', def: '6/1h' },
};

/** Resolve a named limit from env. A malformed value falls back to the
 *  default with a warning rather than taking the API down. */
export function limitFromEnv(name: LimitName, env: NodeJS.ProcessEnv = process.env): LimitSpec | null {
  if ((env.TRAILHEAD_RATE_LIMIT ?? '').toLowerCase() === 'off') return null;
  const { env: key, def } = ENV[name];
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return parseLimit(def);
  try {
    return parseLimit(raw);
  } catch (err) {
    console.warn(`[rate-limit] ${(err as Error).message} in ${key}; using the default ${def}`);
    return parseLimit(def);
  }
}

// One limiter per (name, spec). Keyed on the spec text so changing the env
// (tests, or a process manager reloading config) starts fresh buckets.
const limiters = new Map<string, TokenBucketLimiter>();

export function limiterFor(name: LimitName, env: NodeJS.ProcessEnv = process.env): TokenBucketLimiter | null {
  const spec = limitFromEnv(name, env);
  if (!spec) return null;
  const key = `${name}:${spec.text}`;
  let l = limiters.get(key);
  if (!l) {
    l = new TokenBucketLimiter(spec);
    limiters.set(key, l);
  }
  return l;
}

/** Test hook: forget every bucket. */
export function resetRateLimiters(): void {
  limiters.clear();
}

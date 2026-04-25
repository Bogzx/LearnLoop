// Stop hook library: reads stdin, parses payload, extracts last turn,
// optionally calls Haiku, optionally POSTs to /wiki/propose. Split out from
// the entrypoint so it's testable.
//
// Two payload formats supported:
// 1. The real Claude Code Stop hook payload: { transcript_path, ... } —
//    we read the transcript JSONL and pull the last user turn + last
//    assistant turn.
// 2. A direct payload for tests / scripted invocation:
//    { user_prompt: "...", assistant_response: "..." }
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  EXTRACT_SYSTEM_PROMPT,
  parseExtractResponse,
} from '@trailhead/scoring/extract-prompt';

const LOG = join(homedir(), '.trailhead-hook.log');

export function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    appendFileSync(LOG, line);
  } catch {}
  try {
    process.stderr.write(`[trailhead-hook] ${msg}\n`);
  } catch {}
}

// Read all of stdin as a UTF-8 string. fd 0 is the hook payload pipe.
export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

// Parse a transcript JSONL file to the last user prompt + last assistant
// response. Format: each line is one event with `role` and `content` (or
// `message.content` depending on Claude Code version). We accept several
// shapes defensively.
export function extractFromTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter((l) => l.trim());
  let userPrompt = '';
  let assistantResponse = '';
  // Walk in order; later messages overwrite earlier ones, so the last user
  // and last assistant turn win.
  for (const line of lines) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    const role = evt.role ?? evt.message?.role ?? evt.type;
    const content = evt.content ?? evt.message?.content;
    const text = stringifyContent(content);
    if (!text) continue;
    if (role === 'user') userPrompt = text;
    else if (role === 'assistant') assistantResponse = text;
  }
  return { user_prompt: userPrompt, assistant_response: assistantResponse };
}

// Content blocks can be a string or an array of {type, text} blocks.
function stringifyContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? (b.text ?? '') : ''))
    .join('\n')
    .trim();
}

// Top-level payload extraction. Returns { user_prompt, assistant_response }
// or null if neither path yielded anything.
export function extractTurn(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.user_prompt === 'string' || typeof payload.assistant_response === 'string') {
    return {
      user_prompt: payload.user_prompt ?? '',
      assistant_response: payload.assistant_response ?? '',
    };
  }
  if (typeof payload.transcript_path === 'string') {
    return extractFromTranscript(payload.transcript_path);
  }
  return null;
}

// Cheap heuristic: short assistant turns rarely contain durable conventions.
// Cuts ~half of Haiku calls (roadmap §5 #5).
export function shouldSkip(turn) {
  if (!turn) return 'no turn';
  const r = turn.assistant_response ?? '';
  if (r.length < 80) return 'response too short';
  return null;
}

// Calls Haiku and returns either a parsed learning or null.
export async function extractLearning({ turn, anthropicKey }) {
  if (!anthropicKey) {
    log('skipped: ANTHROPIC_API_KEY not set');
    return null;
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: anthropicKey });
  const userMessage =
    `User prompt:\n${turn.user_prompt}\n\nAssistant response:\n${turn.assistant_response}`;
  let res;
  try {
    res = await client.messages.create({
      model: 'claude-haiku-4-5',
      system: [
        // cache_control on the system block makes the cached system prompt
        // identical across hook calls — high cache hit rate, low cost.
        {
          type: 'text',
          text: EXTRACT_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 200,
    });
  } catch (e) {
    log(`haiku error: ${e.message ?? e}`);
    return null;
  }
  const text = (res.content ?? [])
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
  const parsed = parseExtractResponse(text);
  return parsed.learning;
}

// POST the learning. Returns the API response, or null on error.
export async function postLearning({ apiUrl, teamToken, learning }) {
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/wiki/propose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Team-Token': teamToken,
      },
      body: JSON.stringify({
        node_path: learning.node_path,
        insight: learning.insight,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      log(`POST /wiki/propose ${res.status}: ${text}`);
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      log(`POST /wiki/propose returned non-JSON: ${text}`);
      return null;
    }
    return parsed;
  } catch (e) {
    log(`POST /wiki/propose error: ${e.message ?? e}`);
    return null;
  }
}

// Entry point. Composes the pieces; never throws.
export async function runHook({ apiUrl, teamToken, anthropicKey, stdin }) {
  try {
    if (!apiUrl || !teamToken) {
      log('skipped: TRAILHEAD_API_URL or TRAILHEAD_TEAM_TOKEN not set');
      return { skipped: 'config' };
    }

    const raw = stdin ?? readStdin();
    if (!raw) {
      log('skipped: empty stdin');
      return { skipped: 'no-stdin' };
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      log(`skipped: stdin not JSON (${raw.length}b)`);
      return { skipped: 'bad-json' };
    }
    const turn = extractTurn(payload);
    const skipReason = shouldSkip(turn);
    if (skipReason) {
      log(`skipped: ${skipReason}`);
      return { skipped: skipReason };
    }

    const learning = await extractLearning({ turn, anthropicKey });
    if (!learning) {
      log('no learning extracted');
      return { skipped: 'no-learning' };
    }
    log(`learning: ${learning.node_path} :: ${learning.insight}`);

    const result = await postLearning({ apiUrl, teamToken, learning });
    if (!result) return { skipped: 'post-failed' };
    log(`posted: action=${result.action} count=${result.current_count}`);
    return { posted: result, learning };
  } catch (e) {
    log(`unhandled error: ${e?.stack ?? e?.message ?? e}`);
    return { skipped: 'unhandled' };
  }
}

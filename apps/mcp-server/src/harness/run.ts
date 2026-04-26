// Core of the replay harness — calls Gemini-Flash with the 3 hero tool
// definitions attached and the canonical coaching directive as the system
// prompt, then returns which tool the model picked. Used by both the
// single-prompt CLI (try.ts) and the matrix runner (matrix.ts).
//
// Why Gemini and not Claude/Copilot directly: GEMINI_API_KEY is already
// wired (memory: project_trailhead.md), free-tier quota covers iteration,
// tool-call behavior is close enough to catch description regressions.
//
// Tool execution is mocked by default. The harness's job is "did the model
// pick the right tool given the prompt + descriptions?", not "did the API
// return the right JSON?". Pass live=true to round-trip the real call.
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { COACHING_DIRECTIVE_TEXT } from '../directive.ts';
import {
  COACH_DESC,
  WIKI_BOOTSTRAP_DESC,
  WIKI_LOOKUP_DESC,
  WIKI_SAVE_DESC,
} from '../tools.ts';

export interface RunResult {
  // Which tool the model picked. `null` means it answered with text instead.
  tool: string | null;
  // Args the model passed (raw object). Empty when tool === null.
  args: Record<string, unknown>;
  // The model's text response, if any (typically empty when a tool is picked).
  text: string;
  // Round-trip duration in ms.
  latencyMs: number;
}

// Gemini-formatted tool definitions. Mirror the MCP tools in tools.ts; the
// description prose is shared via the *_DESC constants. Schema types are
// duplicated here in @google/genai's `Type` enum form because MCP uses zod
// and we don't want to pull a zod-to-jsonschema dep into the harness.
const COACH_FN: FunctionDeclaration = {
  name: 'coach',
  description: COACH_DESC,
  parameters: {
    type: Type.OBJECT,
    required: ['prompt'],
    properties: {
      prompt: { type: Type.STRING, description: "The user's exact prompt." },
      file_path: { type: Type.STRING, description: 'Optional repo-relative path.' },
      mode: {
        type: Type.STRING,
        enum: ['score', 'augment'],
        description: 'Default "score". Use "augment" to one-shot rewrite.',
      },
    },
  },
};

const WIKI_LOOKUP_FN: FunctionDeclaration = {
  name: 'wiki_lookup',
  description: WIKI_LOOKUP_DESC,
  parameters: {
    type: Type.OBJECT,
    properties: {
      file_path: { type: Type.STRING, description: 'Repo-relative path.' },
      query: { type: Type.STRING, description: 'Free-text search.' },
      rules_only: { type: Type.BOOLEAN, description: 'Default false.' },
    },
  },
};

const WIKI_SAVE_FN: FunctionDeclaration = {
  name: 'wiki_save',
  description: WIKI_SAVE_DESC,
  parameters: {
    type: Type.OBJECT,
    required: ['node_path', 'insight'],
    properties: {
      node_path: { type: Type.STRING, description: "Folder path ending in '/'." },
      insight: { type: Type.STRING, description: 'One-sentence convention.' },
    },
  },
};

const WIKI_BOOTSTRAP_FN: FunctionDeclaration = {
  name: 'wiki_bootstrap',
  description: WIKI_BOOTSTRAP_DESC,
  parameters: {
    type: Type.OBJECT,
    properties: {
      paths: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Optional explicit list, e.g. ['src/api/', 'src/db/']. Omit to auto-discover.",
      },
      seed_from_files: {
        type: Type.BOOLEAN,
        description: 'Default true — seed root from CLAUDE.md / copilot-instructions.md.',
      },
    },
  },
};

const HARNESS_TOOLS = [
  {
    functionDeclarations: [
      COACH_FN,
      WIKI_LOOKUP_FN,
      WIKI_SAVE_FN,
      WIKI_BOOTSTRAP_FN,
    ],
  },
];

const MODEL = process.env.HARNESS_MODEL ?? 'gemini-3-flash-preview';

let cachedClient: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it to .env at the repo root (the harness reads it via process.env).',
    );
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

export async function runPrompt(prompt: string): Promise<RunResult> {
  const t0 = Date.now();
  const resp = await client().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: COACHING_DIRECTIVE_TEXT,
      // Low temperature — we want the tool-pick to be stable across runs so
      // matrix results are reproducible.
      temperature: 0.1,
      // Disable thinking to keep latency sub-second. Tool selection doesn't
      // need a planning step.
      thinkingConfig: { thinkingBudget: 0 },
      tools: HARNESS_TOOLS,
    },
  });
  const latencyMs = Date.now() - t0;

  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  const fnCall = parts.find((p) => p.functionCall)?.functionCall;
  const text = parts
    .filter((p) => typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text)
    .join('')
    .trim();

  return {
    tool: fnCall?.name ?? null,
    args: (fnCall?.args ?? {}) as Record<string, unknown>,
    text,
    latencyMs,
  };
}

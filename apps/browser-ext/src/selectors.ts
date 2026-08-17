// Single source of truth for every Claude.ai DOM selector this extension
// touches. Each role has a fallback chain so one DOM rotation in Claude.ai
// shouldn't take the extension out — change one entry here and the entire
// surface re-aims (spec §4.7 / §6.2).
//
// resolveSelectors() returns null on a miss. content.ts schedules a 5s retry
// in that case (spec §5.1).

export interface Selectors {
  /** The composer textarea / contenteditable element. */
  textarea: HTMLElement;
  /** Send button. May be null if Claude.ai re-renders it after focus. */
  sendButton: HTMLElement | null;
  /** Conversation root that holds rendered messages. */
  messageList: HTMLElement;
  /** Anchor below which the score-card mounts. */
  scoreCardAnchor: HTMLElement;
}

interface SelectorChain {
  role: keyof Selectors;
  /** ordered list of selector strings to try */
  candidates: string[];
}

const CHAINS: SelectorChain[] = [
  {
    role: 'textarea',
    candidates: [
      'div[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'textarea[data-testid="composer"]',
      'textarea[placeholder*="Reply"]',
      'textarea[placeholder*="Talk"]',
      'textarea[placeholder*="message"]',
      'fieldset textarea',
      'textarea',
    ],
  },
  {
    role: 'sendButton',
    candidates: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Send"]',
      'button[data-testid*="send"]',
      'fieldset button[type="submit"]',
      'button[type="submit"]',
    ],
  },
  {
    role: 'messageList',
    candidates: [
      'main [data-testid*="conversation"]',
      'main [class*="conversation"]',
      'main div[role="log"]',
      'main',
      '[role="main"]',
      '[data-testid*="conversation"]',
      // Chat pages on claude.ai/chat/<id> drop <main> entirely — fall back to
      // whatever ancestor wraps the user/assistant bubbles, then to <body>.
      'div:has([data-testid="user-message"])',
      'body',
    ],
  },
];

function findFirst(candidates: readonly string[]): HTMLElement | null {
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

function chainFor(role: keyof Selectors): readonly string[] {
  for (const c of CHAINS) if (c.role === role) return c.candidates;
  return [];
}

export function resolveSelectors(): Selectors | null {
  const textarea = findFirst(chainFor('textarea'));
  const messageList = findFirst(chainFor('messageList'));
  if (!textarea || !messageList) return null;

  // sendButton lookup is best-effort — Claude.ai sometimes mounts the button
  // only after the user types. Send-intercept hooks Enter as the primary
  // path and treats the button as a bonus surface.
  const sendButton = findFirst(chainFor('sendButton'));

  // The card anchors directly below the composer. Climb to the closest
  // form/composer wrapper so we sit outside the textarea but still inside
  // the composer area's flow.
  const composerWrapper =
    textarea.closest('form') ?? textarea.closest('[role="form"]') ?? textarea.parentElement!;

  return {
    textarea,
    sendButton,
    messageList,
    scoreCardAnchor: composerWrapper,
  };
}

/** Read the text content of the textarea (works for both contenteditable
 * and <textarea>). */
export function readPrompt(textarea: HTMLElement): string {
  if (textarea instanceof HTMLTextAreaElement) return textarea.value;
  return textarea.innerText ?? textarea.textContent ?? '';
}

/** Best-effort classifier for a freshly observed bubble. The hour-6 smoke
 * test (spec §19, roadmap §2) is where these heuristics get refined. */
export type BubbleRole = 'user' | 'assistant' | 'unknown';

const USER_HINTS = [
  '[data-testid="user-message"]',
  '[data-testid*="user"]',
  '[data-testid*="human"]',
  '.font-user-message',
  '[class*="user-message"]',
  '[class*="human-turn"]',
];
const ASSISTANT_HINTS = [
  '[data-testid="assistant-message"]',
  '[data-testid*="assistant"]',
  '[data-testid*="claude"]',
  '.font-claude-message',
  '[class*="claude-message"]',
  '[class*="assistant-turn"]',
];

/**
 * Every selector that can identify a bubble, as one comma-joined list.
 *
 * The content script queries with this directly instead of walking every
 * `div, article, li` on the page and asking each one whether it looks like a
 * bubble. Same results, a fraction of the work, and no ambiguity about which
 * element in a nesting chain is "the" bubble.
 */
export const BUBBLE_HINT_SELECTOR = [...USER_HINTS, ...ASSISTANT_HINTS].join(',');

/**
 * Classify an element that is already known to be a bubble candidate.
 *
 * Matches on the element ITSELF only. This used to also accept
 * `node.querySelector(sel)` — a match anywhere in the subtree — which meant
 * every ancestor of a user message classified as a user bubble, all the way up
 * to the conversation container and `body`. Since the caller walked the DOM
 * outermost-first and let the outermost match win, a single wrapper div
 * swallowed the entire thread and got tagged as one giant "user bubble".
 */
export function classifyBubble(node: Element): BubbleRole {
  for (const sel of USER_HINTS) {
    if (node.matches?.(sel)) return 'user';
  }
  for (const sel of ASSISTANT_HINTS) {
    if (node.matches?.(sel)) return 'assistant';
  }
  return 'unknown';
}

/** Read the visible text of a bubble. Falls back to textContent when innerText
 * is empty (off-screen elements report 0-length innerText in some Chromium
 * versions). */
export function readBubbleText(node: Element): string {
  const el = node as HTMLElement;
  const inner = el.innerText?.trim();
  if (inner) return inner;
  return el.textContent?.trim() ?? '';
}

/** Replace the textarea content. Two cases:
 *
 *  - `<textarea>` with React-controlled value: bypass React's setter shadow
 *    (the descriptor on the prototype) so setting `value` actually sticks,
 *    then dispatch a synthetic `input` event for the onChange handler.
 *  - `contenteditable` (Claude.ai uses Lexical): innerText assignment does
 *    NOT update the editor's internal state; Lexical reads from
 *    `beforeinput` events instead. The reliable cross-editor pattern is
 *    focus → select-all → `execCommand('insertText', value)`, which makes
 *    the browser fire a real `beforeinput` the editor respects.
 *    `execCommand` is deprecated but Chrome still implements it and Lexical
 *    listens for the events it produces.
 */
export function writePrompt(textarea: HTMLElement, value: string): void {
  if (textarea instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  textarea.focus();
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(textarea);
    selection.addRange(range);
  }
  // Try execCommand first — Lexical / ProseMirror / contenteditable React
  // components all honour the beforeinput it fires.
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, value);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    // Last-resort fallback: write innerText and dispatch a synthetic input
    // event with inputType set so Lexical's onInput handler sees the field.
    textarea.innerText = value;
    textarea.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
    );
  }
}

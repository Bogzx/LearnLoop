// Small helpers around the scorer prompt + the browser-ext augmentation
// template. Live with the score prompt so changes to wording stay
// co-located with the scorer.

// Build the user message for the /score call. File context goes first so
// the model sees the path before reading the prompt body.
export function buildScoreUserPrompt(args) {
  const ctx = args && args.file_path ? `File context: ${args.file_path}\n\n` : '';
  const prompt = (args && args.prompt) || '';
  return `${ctx}Prompt:\n${prompt}`;
}

// "Have Claude clarify" augmentation (spec §6). Inserted by the browser
// extension when the user opts in below the ≥7 threshold. Kept here so
// the wording stays in sync with the scoring rubric — both surfaces read
// the same dimension names.
export function buildAugmentation(opts) {
  const original = (opts && opts.original) || '';
  const missing = (opts && opts.missing) || {};
  const dims = Object.keys(missing).map((d) => d.replace(/_/g, ' '));
  const list =
    dims.length === 0
      ? 'a few key dimensions'
      : dims.length === 1
        ? dims[0]
        : `${dims.slice(0, -1).join(', ')} and ${dims[dims.length - 1]}`;

  return `${original}

---
[Trailhead coaching: This prompt is missing ${list}.
Before answering, please ask the user 2-3 clarifying questions to fill those
gaps (file/folder, current helper, constraints, expected output shape).
Only proceed once these are clarified.]`;
}

// Per-dimension teach-block content. Three small strings per dimension:
//
//   title:      human-friendly name shown in the block header
//   definition: one short clause completing "<title> means…"
//   why:        short paragraph explaining why this dimension matters
//   question:   the clarifying ask the user is invited to answer
//
// All five dimensions are present; the /coach pipeline indexes by the lowest-
// scoring dimension and picks one entry. Short, declarative, no prose.

export const DIMENSION_TEACH = {
  goal_clarity: {
    title: 'Goal clarity',
    definition: 'state the desired outcome unambiguously, not the absence of a problem.',
    why: 'Without a target the AI guesses. "Make this better" leaves dozens of valid changes; "reduce p99 latency to 200ms" picks one.',
    question: 'What concrete outcome should be true after the change?',
  },
  specificity: {
    title: 'Specificity',
    definition: 'name WHAT changes, not the goal.',
    why: 'A goal is a wish; a change is an action. "Be more accurate" is a goal — name the function, error message, line, or paragraph the AI should touch.',
    question: 'What specifically should change? Name a function, file, error, or line.',
  },
  context_loading: {
    title: 'Context loading',
    definition: 'reference the relevant file, function, convention, or related code.',
    why: 'The AI does not know your codebase. Saying which file or pattern grounds its answer in real code instead of plausible-looking guesses.',
    question: 'Which file or function is this about? Mention the path or the name.',
  },
  constraint_articulation: {
    title: 'Constraints',
    definition: 'state invariants and boundaries the change must respect.',
    why: 'Without constraints the AI may "fix" things you wanted to keep — change a public API, break idempotency, modify shared state. Constraints lock those down.',
    question: 'What constraints must hold? (max attempts, idempotency, no API change, must remain backwards-compatible, etc.)',
  },
  output_specification: {
    title: 'Output shape',
    definition: 'request the desired form of the answer.',
    why: 'Default AI output is verbose prose with the code buried in it. Specifying "only the modified function, no explanation" cuts noise and makes the diff easy to apply.',
    question: 'What output do you want? (only the changed function, full file, a diff, just the SQL, etc.)',
  },
};

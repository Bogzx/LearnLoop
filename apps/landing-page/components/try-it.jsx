// Try it — score a prompt in the browser with LearnLoop's rule-based scorer.
//
// assets/heuristic-score.js is a byte-identical copy of
// packages/scoring/src/heuristic-score.mjs (a test in packages/scoring keeps
// them in sync). index.html imports it as a module and puts it on
// window.heuristicScore; this component waits for it. Nothing typed here
// leaves the page.

const TRY_EXAMPLES = [
  { label: 'Vague', prompt: 'fix the retry' },
  { label: 'Halfway', prompt: 'In the webhook handler, add retries with exponential backoff when the downstream call fails.' },
  {
    label: 'Specific',
    prompt:
      'In src/api/webhooks/handler.ts, deliver() gives up after one failure. Add retries: up to 3 attempts with ' +
      'exponential backoff (200ms, 400ms, 800ms), only on 5xx and network errors. Constraints: the handler must stay ' +
      'idempotent and no new dependencies. Return only the diff for handler.ts.',
  },
];

const TRY_DIMS = [
  ['goal_clarity', 'Goal clarity'],
  ['specificity', 'Specificity'],
  ['context_loading', 'Context'],
  ['constraint_articulation', 'Constraints'],
  ['output_specification', 'Output shape'],
];

const EVAL_URL = 'https://github.com/Bogzx/LearnLoop/blob/main/apps/api/eval/README.md';

function scoreTone(n) {
  if (n >= 7) return '#2BC68A';
  if (n >= 4) return '#E5A24F';
  return '#E26F95';
}

function useHeuristicScorer() {
  const [scorer, setScorer] = useState(() => window.heuristicScore ?? null);
  useEffect(() => {
    if (scorer) return;
    const ready = () => setScorer(() => window.heuristicScore);
    window.addEventListener('heuristic-score-ready', ready);
    if (window.heuristicScore) ready();
    return () => window.removeEventListener('heuristic-score-ready', ready);
  }, [scorer]);
  return scorer;
}

function TryIt() {
  const scorer = useHeuristicScorer();
  const [prompt, setPrompt] = useState(TRY_EXAMPLES[0].prompt);
  const result = useMemo(() => (scorer && prompt.trim() ? scorer(prompt) : null), [scorer, prompt]);
  const dims = result?.dimensions;
  const overall = dims ? Math.round(TRY_DIMS.reduce((s, [k]) => s + dims[k], 0) / TRY_DIMS.length) : null;

  return (
    <section id="try" className="relative py-20 md:py-28 border-t hairline">
      <Container>
        <div className="max-w-3xl mx-auto text-center">
          <SectionKicker>Try it</SectionKicker>
          <SectionTitle>Score a prompt, right here.</SectionTitle>
          <p className="mt-6 text-ink-500 text-lg leading-relaxed text-pretty">
            The same five dimensions LearnLoop scores in your editor and on Claude.ai. This box runs the{' '}
            <span className="text-ink-900">rule-based scorer</span> in your browser: the one the API uses when it
            runs without a model. The product itself scores with Gemini; the two have not been compared
            yet (
            <a href={EVAL_URL} className="underline decoration-ink-300 hover:text-ink-900">how the scoring is measured</a>).
          </p>
        </div>

        <div className="mt-10 md:mt-12 grid grid-cols-1 md:grid-cols-[1.15fr_1fr] gap-5 max-w-5xl mx-auto">
          <div className="paper-card p-5 md:p-6 flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="meta mr-1">Examples</span>
              {TRY_EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setPrompt(ex.prompt)}
                  className={`rounded-full border px-3 py-1 text-[13px] transition ${prompt === ex.prompt ? 'border-[#1FA29A] text-ink-900 bg-white' : 'hairline-strong text-ink-500 hover:text-ink-900'}`}
                >
                  {ex.label}
                </button>
              ))}
            </div>
            <label htmlFor="try-prompt" className="sr-only">Your prompt</label>
            <textarea
              id="try-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder="Paste a prompt you'd send to Claude or Copilot…"
              className="mt-4 w-full flex-1 min-h-[180px] rounded-md border hairline-strong bg-paper-50 px-3.5 py-3 text-ink-900 font-mono text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#1FA29A]/30 focus:border-[#1FA29A]"
            />
            <p className="mt-3 meta text-[10px] text-ink-400 normal-case tracking-normal">
              Runs entirely in this page. Nothing you type is sent anywhere.
            </p>
          </div>

          <div className="paper-card p-5 md:p-6" aria-live="polite">
            {!scorer ? (
              <div className="h-full min-h-[240px] flex items-center justify-center text-ink-400 text-sm">Loading the scorer…</div>
            ) : !dims ? (
              <div className="h-full min-h-[240px] flex items-center justify-center text-ink-400 text-sm">Type a prompt to score it.</div>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="meta">Overall</span>
                  <span className="font-serif text-5xl leading-none" style={{ color: scoreTone(overall) }} data-testid="try-overall">
                    {overall}<span className="text-ink-300 text-2xl">/10</span>
                  </span>
                </div>
                <p className="mt-2 text-[13px] text-ink-500">
                  {overall >= 7
                    ? 'At 7 or more LearnLoop lets the prompt through without coaching.'
                    : 'Below 7, LearnLoop would hold the send and coach the weakest dimension first.'}
                </p>
                <div className="mt-5 space-y-3">
                  {TRY_DIMS.map(([key, label]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between text-[13px]">
                        <span className="text-ink-700">{label}</span>
                        <span className="font-mono tabular-nums text-ink-900">{dims[key]}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-paper-200 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${dims[key] * 10}%`, background: scoreTone(dims[key]) }} />
                      </div>
                      {result.missing[key] && <div className="mt-1 text-[12px] text-ink-400">{result.missing[key]}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

window.TryIt = TryIt;

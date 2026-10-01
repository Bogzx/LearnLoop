// Problem · Features · Demo

function Problem() {
  return (
    <section id="problem" className="relative py-20 md:py-28 border-t hairline">
      <Container>
        <div className="max-w-3xl mx-auto text-center">
          <SectionKicker>The problem</SectionKicker>
          <SectionTitle>
            The problem isn't AI.<br/>
            It's that teams don't know how to use it <span className="grad-brand accent-italic">together.</span>
          </SectionTitle>
          <p className="mt-6 md:mt-8 text-ink-500 text-lg md:text-xl leading-relaxed text-pretty">
            Most developers use AI on their own. What one person learns about prompting the
            team's codebase rarely reaches anyone else. The result: inconsistent prompts, lost context,
            and slow onboarding.
          </p>
        </div>
      </Container>
    </section>
  );
}

function Features() {
  const features = [
    {
      tag: 'capability 01',
      title: "Standardizes every prompt to your team's voice",
      body: <>Every prompt is scored when you send it, on <span className="text-ink-900">goal · specificity · context · constraints · output</span>. Below 7/10 the send is held and you choose: <em>Improve</em> (a short Q&A that rewrites the prompt with your team's conventions), send as-is, or edit. Nothing is sent without you. The vague "fix the retry" becomes a spec the model can actually answer.</>,
      backed: 'apps/browser-ext + apps/vscode-ext · POST /score',
      mock: <ScorecardMock/>,
    },
    {
      tag: 'capability 02',
      title: "Loads your knowledge base into the LLM's context",
      body: <>Your repo's wiki — patterns, conventions, past decisions, hard-won bug fixes — goes into the model's context for the part of the codebase you're working in: the MCP server looks it up per file, and the browser extension prepends it for the wiki node you pick. Stop pasting links into chat and re-explaining your codebase.</>,
      backed: 'GET /examples · GET /wiki · apps/api',
      mock: <ExamplesMock/>,
    },
    {
      tag: 'capability 03',
      title: "Auto-updates with every member's contribution",
      body: <>Strong prompts join the team's prompt library (mean score ≥ 7, no dimension below 5, confirmed by a second independent score), and conventions people state are deduplicated into the wiki, becoming durable after three mentions. Both become context for the next person who works in the same place.</>,
      backed: 'wiki_save · POST /wiki/propose',
      mock: <WikiMock/>,
    },
    {
      tag: 'everywhere',
      title: 'Functional wherever you use AI',
      body: <>Same coach. Same context. Same wiki. Whether the dev is in <span className="text-ink-900">Claude.ai</span> brainstorming, <span className="text-ink-900">VS Code</span> shipping, or <span className="text-ink-900">Claude Code / Copilot Chat</span> automating — LearnLoop is the connective tissue across the surfaces your team already uses.</>,
      backed: 'browser-ext · vscode-ext · mcp-server (5 tools)',
      mock: <SurfacesMock/>,
    },
  ];

  return (
    <section id="features" className="relative py-20 md:py-28 border-t hairline">
      <Container>
        <div className="max-w-3xl mx-auto text-center">
          <SectionKicker>Solution</SectionKicker>
          <SectionTitle>
            <span className="grad-brand accent-italic">LearnLoop</span> — your team's prompts, standardized and shared.
          </SectionTitle>
          <p className="mt-5 text-ink-500 text-base md:text-lg">
            Standardize prompts · inject team context · auto-update from every contribution.
          </p>
        </div>

        <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-3 gap-5">
          {features.slice(0,3).map((f, i) => (
            <FeatureCard key={i} f={f} stacked />
          ))}
        </div>
        <div className="mt-5">
          <FeatureCard f={features[3]} wide />
        </div>
      </Container>
    </section>
  );
}

function FeatureCard({ f, wide, stacked }) {
  if (stacked) {
    return (
      <article className="paper-card overflow-hidden lift flex flex-col">
        <div className="bg-paper-100/60 border-b hairline p-5 flex items-center justify-center min-h-[180px]">
          {f.mock}
        </div>
        <div className="p-6 md:p-7 flex-1 flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <div className="meta" style={{color:'#0E7B7A'}}>{f.tag}</div>
          </div>
          <h3 className="h-card mt-3 font-serif text-xl md:text-[22px] tracking-tight text-ink-900 text-balance">{f.title}</h3>
          <p className="mt-3 text-ink-500 text-[14px] leading-relaxed text-pretty flex-1">{f.body}</p>
        </div>
      </article>
    );
  }
  return (
    <article className="paper-card overflow-hidden lift">
      <div className={`grid ${wide ? 'md:grid-cols-[1.4fr_1fr]' : 'md:grid-cols-[1fr_1fr]'} gap-0`}>
        <div className="p-6 md:p-7">
          <div className="flex items-center justify-between">
            <div className="meta" style={{color:'#0E7B7A'}}>{f.tag}</div>
          </div>
          <h3 className="h-card mt-3 font-serif text-2xl md:text-[28px] tracking-tight text-ink-900">{f.title}</h3>
          <p className="mt-3 text-ink-500 text-[15px] leading-relaxed text-pretty">{f.body}</p>
        </div>
        <div className="bg-paper-100/60 border-t md:border-t-0 md:border-l hairline p-4 md:p-5 flex items-center justify-center min-h-[160px]">
          {f.mock}
        </div>
      </div>
    </article>
  );
}

function SurfacesMock() {
  const surfaces = [
    { name:'Browser', sub:'Claude.ai (Chrome)',          tone:'#2BC68A' },
    { name:'VS Code', sub:'sidebar score card',            tone:'#3D8BFF' },
    { name:'CLI / MCP', sub:'Claude Code · Copilot Chat',  tone:'#9C7AD9' },
  ];
  return (
    <div className="w-full max-w-[520px] grid grid-cols-3 gap-2.5">
      {surfaces.map(s => (
        <div key={s.name} className="rounded-md border hairline bg-white px-3 py-3 text-center">
          <div className="w-2 h-2 rounded-full mx-auto mb-2" style={{background:s.tone}} />
          <div className="font-mono text-[11px] text-ink-900">{s.name}</div>
          <div className="meta text-[8px] text-ink-400 mt-1 normal-case tracking-normal">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

function ScorecardMock() {
  return (
    <div className="w-full max-w-[260px]">
      <div className="rounded-md border hairline-strong bg-white px-3 py-2 text-[11px] font-mono text-ink-700">fix the retry</div>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {[['goal',2,'#2BC68A'],['spec',3,'#3D8BFF'],['ctx',1,'#E5A24F'],['cstr',1,'#9C7AD9'],['out',2,'#E26F95']].map(([k,v,c]) => (
          <div key={k} className="flex flex-col items-stretch gap-1">
            <div className="h-10 rounded-sm bg-paper-200 relative overflow-hidden">
              <div className="absolute bottom-0 left-0 right-0" style={{height: `${v*10}%`, background: c}}/>
            </div>
            <div className="text-[8px] text-center font-mono text-ink-400 uppercase">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExamplesMock() {
  return (
    <div className="w-full max-w-[280px] space-y-1.5 font-mono text-[10px]">
      <div className="meta text-[9px]">webhook.ts · 3 prompts</div>
      {[
        ['ana','add idempotency key + 5 retries'],
        ['marco','wrap in retry helper, jitter on'],
        ['lina','idempotent, max 5, log fails'],
      ].map(([who,p]) => (
        <div key={who} className="rounded-sm border hairline bg-white px-2 py-1.5 flex items-start gap-2">
          <span className="meta text-[8px] w-10 shrink-0" style={{color:'#1FA29A'}}>{who}</span>
          <span className="text-ink-700">{p}</span>
        </div>
      ))}
    </div>
  );
}

function WikiMock() {
  return (
    <svg viewBox="0 0 240 140" className="w-full max-w-[260px]">
      <g fontFamily="JetBrains Mono" fontSize="9" fill="#5C7A80">
        <rect x="0" y="60" width="80" height="22" rx="4" fill="#FFFFFF" stroke="#1FA29A"/>
        <text x="40" y="74" textAnchor="middle" fill="#0E1A1F">.prompts/</text>

        <line x1="80" y1="71" x2="120" y2="40" stroke="#D5DEE0"/>
        <line x1="80" y1="71" x2="120" y2="71" stroke="#D5DEE0"/>
        <line x1="80" y1="71" x2="120" y2="102" stroke="#D5DEE0"/>

        <rect x="120" y="28" width="120" height="22" rx="4" fill="#FFFFFF" stroke="#D5DEE0"/>
        <text x="128" y="42" fill="#0E1A1F">retry-patterns.md</text>

        <rect x="120" y="60" width="120" height="22" rx="4" fill="#FFFFFF" stroke="#2BC68A"/>
        <text x="128" y="74" fill="#0E1A1F">webhook-conventions.md</text>
        <circle cx="232" cy="71" r="3" fill="#2BC68A"/>

        <rect x="120" y="92" width="120" height="22" rx="4" fill="#FFFFFF" stroke="#D5DEE0"/>
        <text x="128" y="106" fill="#0E1A1F">api-error-shape.md</text>
      </g>
    </svg>
  );
}

function Demo() {
  return (
    <section id="demo" className="relative py-20 md:py-28 border-t hairline overflow-hidden">
      <Orbs variant="quiet" />
      <Container className="relative">
        <div className="max-w-3xl mx-auto text-center">
          <SectionKicker>Demo</SectionKicker>
          <SectionTitle>
            A walkthrough of <span className="grad-brand accent-italic">LearnLoop</span> in action.
          </SectionTitle>
        </div>

        <div className="mt-12 md:mt-16 max-w-5xl mx-auto">
          <div className="paper-card overflow-hidden">
            <div className="relative" style={{aspectRatio:'16 / 9', background:'#0E1A1F'}}>
              <iframe
                className="absolute inset-0 w-full h-full"
                src="https://www.youtube.com/embed/kD6nnJAmRK8"
                title="LearnLoop demo"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

window.Problem = Problem;
window.Features = Features;
window.Demo = Demo;

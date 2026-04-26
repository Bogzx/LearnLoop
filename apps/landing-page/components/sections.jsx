// Problem · Solution · Features · Demo

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
            Today, almost every developer uses AI individually — but fewer than 25% know how to integrate
            it into how their team actually works. The result: inconsistent prompts, lost context,
            and slow onboarding.
          </p>
        </div>
      </Container>
    </section>
  );
}

function Solution() {
  const pillars = [
    {
      n:'01',
      title:'Standardizes every prompt to your team',
      body:"A 5-dimension scorecard runs live under every textarea — goal, specificity, context, constraints, output. Below 7/10? It rewrites the prompt in your team's voice, with your team's conventions, before you hit send.",
      tone:'#2BC68A',
    },
    {
      n:'02',
      title:"Loads the knowledge base into the LLM's context",
      body:"Your repo's wiki — patterns, conventions, past decisions — is injected into the model's context automatically, scoped to the file you're working on. No more pasting links or re-explaining the codebase.",
      tone:'#3D8BFF',
    },
    {
      n:'03',
      title:"Auto-updates with every member's contribution",
      body:"Every prompt that scores 9+/10 is auto-deduped into the team wiki, then becomes context for the next person who asks something similar. The team's tribal knowledge compounds — without anyone writing docs.",
      tone:'#9C7AD9',
    },
    {
      n:'04',
      title:'Functional wherever you use AI',
      body:'Same coach, same context, same wiki — across Browser (Claude.ai · ChatGPT · Gemini), VS Code, and CLI / MCP (Claude Code · Copilot). The connective tissue across the surfaces your team already uses.',
      tone:'#E5A24F',
    },
  ];

  return (
    <section id="solution" className="relative py-20 md:py-28 border-t hairline overflow-hidden">
      <Orbs variant="quiet" />
      <Container className="relative">
        <div className="max-w-3xl mx-auto text-center">
          <SectionKicker>The solution</SectionKicker>
          <SectionTitle>
            <span className="grad-brand accent-italic">LearnLoop</span> — your team's prompts, standardized and shared.
          </SectionTitle>
        </div>

        <div className="mt-12 md:mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          {pillars.map(p => (
            <article key={p.n} className="paper-card p-6 md:p-7 lift flex flex-col">
              <div className="flex items-start justify-between">
                <div className="meta tabular-nums" style={{color: p.tone}}>{p.n}</div>
                <span className="w-2 h-2 rounded-full" style={{background: p.tone}} />
              </div>
              <h3 className="h-card mt-4 font-serif text-xl md:text-[22px] leading-tight tracking-tight text-ink-900 text-balance">
                {p.title}
              </h3>
              <p className="mt-3 text-ink-500 text-[14px] leading-relaxed text-pretty">{p.body}</p>
            </article>
          ))}
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
      body: <>A live 5-dimension scorecard runs under every textarea — <span className="text-ink-900">goal · specificity · context · constraints · output</span>. Below 7/10, LearnLoop rewrites the prompt using your team's conventions, the file you're in, and patterns from past wins. The vague "fix the retry" becomes a precise spec the model can actually answer.</>,
      backed: 'apps/browser-ext + apps/vscode-ext · POST /score',
      mock: <ScorecardMock/>,
    },
    {
      tag: 'capability 02',
      title: "Loads your knowledge base into the LLM's context",
      body: <>Your repo's wiki — patterns, conventions, past decisions, hard-won bug fixes — is injected into the model's context automatically, scoped to the file you're editing. Stop pasting links into chat. Stop re-explaining your codebase. The model already knows.</>,
      backed: 'GET /examples · GET /wiki · apps/api',
      mock: <ExamplesMock/>,
    },
    {
      tag: 'capability 03',
      title: "Auto-updates with every member's contribution",
      body: <>Every prompt that scores 9+/10 is auto-deduped into the team wiki, then becomes context for the next person who asks something similar. Team tribal knowledge compounds — without anyone writing docs, holding meetings, or onboarding the new hire by hand.</>,
      backed: 'wiki_save · POST /wiki/propose',
      mock: <WikiMock/>,
    },
    {
      tag: 'everywhere',
      title: 'Functional wherever you use AI',
      body: <>Same coach. Same context. Same wiki. Whether the dev is in <span className="text-ink-900">Claude.ai</span> brainstorming, <span className="text-ink-900">VS Code</span> shipping, or <span className="text-ink-900">Claude Code / Copilot CLI</span> automating — LearnLoop is the connective tissue across the surfaces your team already uses.</>,
      backed: 'browser-ext · vscode-ext · mcp-server (4 tools)',
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
    { name:'Browser', sub:'Claude.ai · ChatGPT · Gemini', tone:'#2BC68A' },
    { name:'VS Code', sub:'extension · ⌘⇧K scaffold',     tone:'#3D8BFF' },
    { name:'CLI / MCP', sub:'Claude Code · Copilot',      tone:'#9C7AD9' },
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

function ScaffoldMock() {
  return (
    <div className="w-full max-w-[280px] terminal">
      <div className="terminal-bar"><span className="dot" style={{background:'#FF5F57'}}/><span className="dot" style={{background:'#FEBC2E'}}/><span className="dot" style={{background:'#28C840'}}/><span className="ml-2 meta text-[9px]">⌘⇧K</span></div>
      <div className="p-3 space-y-2 font-mono text-[10px]">
        {[['goal','reduce p99 latency'],['ctx','src/api/handlers/'],['out','only modified function']].map(([l,v]) => (
          <div key={l}>
            <div className="meta text-[8px]" style={{color:'#0E7B7A'}}>{l}</div>
            <div className="rounded-sm bg-paper-100 px-2 py-1 text-ink-900">{v}</div>
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

function MCPMock() {
  return (
    <div className="w-full max-w-[300px] grid grid-cols-2 gap-1.5 font-mono text-[10px]">
      {['wiki_search','wiki_save','prompt_score','team_examples'].map(t => (
        <div key={t} className="rounded-md border hairline bg-white px-2 py-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{background:'#2BC68A'}}/>
          <span className="text-ink-700">{t}</span>
        </div>
      ))}
    </div>
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
              <div className="absolute inset-0 grid-dots opacity-10" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
                <div className="w-16 h-16 rounded-full flex items-center justify-center"
                     style={{background:'rgba(31,162,154,0.15)', border:'1px solid rgba(31,162,154,0.4)'}}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path d="M7 4l11 7-11 7V4z" fill="#1FA29A"/>
                  </svg>
                </div>
                <div className="font-serif text-2xl md:text-3xl text-paper-100">Demo video coming soon</div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function SkillArcMini() {
  const lines = [
    { c:'#2BC68A', d:'M10 90 L 60 78 L 110 60 L 160 42 L 220 28' },
    { c:'#3D8BFF', d:'M10 96 L 60 88 L 110 76 L 160 60 L 220 42' },
    { c:'#9C7AD9', d:'M10 100 L 60 92 L 110 80 L 160 68 L 220 50' },
    { c:'#E5A24F', d:'M10 104 L 60 100 L 110 92 L 160 80 L 220 64' },
    { c:'#E26F95', d:'M10 108 L 60 104 L 110 96 L 160 86 L 220 72' },
  ];
  return (
    <svg viewBox="0 0 240 130" className="w-full h-full p-3">
      {[30,60,90,120].map(y => <line key={y} x1="10" y1={y} x2="230" y2={y} stroke="#E7EDEE"/>)}
      {lines.map((l,i) => <path key={i} d={l.d} stroke={l.c} strokeWidth="1.6" fill="none"/>)}
      {lines.map((l,i) => {
        const x = 220, y = parseFloat(l.d.split('L').pop().trim().split(' ')[1]);
        return <circle key={i} cx={x} cy={y} r="2.5" fill={l.c}/>;
      })}
    </svg>
  );
}

function TeamMetricsMini() {
  return (
    <div className="w-full h-full p-4 grid grid-cols-2 gap-3 text-center">
      {[
        ['Avg score','6.8','+0.7'],
        ['Reuse','71%','+24%'],
        ['Durable','23','+9'],
        ['Active','12/14','+3'],
      ].map(([l,v,d]) => (
        <div key={l} className="paper-card p-2 flex flex-col justify-center">
          <div className="meta text-[9px]">{l}</div>
          <div className="font-serif text-2xl text-ink-900">{v}</div>
          <div className="text-[10px] font-mono" style={{color:'#0E7B7A'}}>{d}</div>
        </div>
      ))}
    </div>
  );
}

function WikiTreeMini() {
  const nodes = [
    {x:30,y:65,label:'.prompts'},
    {x:120,y:30,label:'patterns'},
    {x:120,y:65,label:'webhook'},
    {x:120,y:100,label:'api'},
    {x:200,y:30,label:'retry'},
    {x:200,y:65,label:'idemp'},
    {x:200,y:100,label:'errors'},
  ];
  return (
    <svg viewBox="0 0 240 130" className="w-full h-full p-3">
      <g stroke="#D5DEE0">
        <line x1="50" y1="65" x2="120" y2="30"/><line x1="50" y1="65" x2="120" y2="65"/><line x1="50" y1="65" x2="120" y2="100"/>
        <line x1="140" y1="30" x2="200" y2="30"/><line x1="140" y1="65" x2="200" y2="65"/><line x1="140" y1="100" x2="200" y2="100"/>
      </g>
      {nodes.map((n,i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="14" fill="#FFFFFF" stroke={i===0 ? '#1FA29A' : '#D5DEE0'}/>
          <text x={n.x} y={n.y+3} textAnchor="middle" fontSize="7" fontFamily="JetBrains Mono" fill="#0E1A1F">{n.label}</text>
        </g>
      ))}
    </svg>
  );
}

window.Problem = Problem;
window.Solution = Solution;
window.Features = Features;
window.Demo = Demo;

// Hero — clean, editorial, mobile-first
function Hero() {
  return (
    <section className="relative overflow-hidden">
      <Orbs variant="hero" />
      <div className="absolute inset-0 grid-dots opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)] pointer-events-none" />

      <Container className="relative pt-12 md:pt-20 pb-16 md:pb-24">
        <div className="text-center max-w-3xl mx-auto">
          {/* top kicker pill */}
          <div className="flex items-center justify-center">
            <span
              className="inline-flex items-center gap-2 rounded-full border hairline-strong bg-white/70 backdrop-blur-sm px-3 py-1.5 meta"
              style={{color:'#0E7B7A'}}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{background:'#1FA29A'}} />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{background:'#1FA29A'}} />
              </span>
              Open source · MIT · self-hosted
            </span>
          </div>

          {/* wordmark */}
          <div className="mt-6 md:mt-8 flex items-center justify-center select-none">
            <span className="font-serif tracking-tight text-ink-900 text-[68px] md:text-[112px] leading-none">
              LearnLoop
            </span>
          </div>

          {/* subtitle */}
          <p className="mt-7 md:mt-9 font-serif text-ink-700 text-2xl md:text-[32px] max-w-2xl mx-auto text-balance leading-[1.25]">
            A <span className="grad-brand accent-italic">prompting coach</span> and team knowledge base —<br className="hidden md:block"/> wherever you write AI.
          </p>

          {/* CTA */}
          <div className="mt-9 md:mt-11 flex flex-col sm:flex-row items-center justify-center gap-3">
            <CtaLinks />
          </div>

          {/* credential cards */}
          <div className="mt-12 md:mt-16 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
            <div className="rounded-md border hairline bg-white/60 backdrop-blur-sm px-4 py-3.5 flex items-center gap-3 text-left">
              <img src="assets/polihack-mark.png" alt="" className="h-9 w-9 rounded-sm flex-shrink-0 object-contain bg-white" />
              <div className="min-w-0">
                <div className="meta text-ink-400 text-[10px]">Hackathon</div>
                <div className="font-serif text-ink-900 text-base leading-tight mt-0.5">PoliHack v19</div>
              </div>
            </div>
            <div className="rounded-md border hairline bg-white/60 backdrop-blur-sm px-4 py-3.5 flex items-center gap-3 text-left">
              <img src="assets/bmw-logo.png" alt="" className="h-9 w-9 rounded-sm flex-shrink-0 object-contain bg-white" />
              <div className="min-w-0">
                <div className="meta text-ink-400 text-[10px]">BMW · AppDev with AI</div>
                <div className="font-serif italic text-ink-900 text-base leading-tight mt-0.5 text-balance">"Applications that encourage AI adoption"</div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

// There is no hosted product or waitlist: LearnLoop is open source and
// self-hosted. The CTAs point at the code, the self-hosting guide and the
// walkthrough video.

function CtaLinks() {
  return (
    <>
      <a
        href={REPO_URL}
        className="rounded-md px-7 py-4 font-medium text-base tracking-wide transition lift inline-flex items-center gap-2"
        style={{background:'#0E1A1F', color:'#FAFBFB'}}
      >
        View on GitHub <span aria-hidden>→</span>
      </a>
      <a
        href={`${REPO_URL}/blob/main/SELFHOSTING.md`}
        className="rounded-md px-6 py-4 font-medium text-base tracking-wide transition lift inline-flex items-center gap-2 border hairline-strong bg-white/70 text-ink-900"
      >
        Self-host it
      </a>
      <a
        href="#demo"
        className="rounded-md px-6 py-4 font-medium text-base tracking-wide transition inline-flex items-center gap-2 text-ink-700 hover:text-ink-900"
      >
        Watch the demo
      </a>
    </>
  );
}

window.Hero = Hero;

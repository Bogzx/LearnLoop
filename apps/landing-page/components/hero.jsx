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
              Closed beta · 2026
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
          <div className="mt-9 md:mt-11 flex justify-center">
            <WaitlistButton />
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

function WaitlistButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-7 py-4 font-medium text-base tracking-wide transition lift inline-flex items-center gap-2"
        style={{background:'#0E1A1F', color:'#FAFBFB'}}
      >
        Join the waitlist <span aria-hidden>→</span>
      </button>
      {open && <WaitlistModal onClose={() => setOpen(false)} />}
    </>
  );
}

function WaitlistModal({ onClose }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | submitting | done | error
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function onSubmit(e) {
    e.preventDefault();
    if (!valid || state === 'submitting') return;
    setState('submitting');
    setError('');
    try {
      const list = JSON.parse(localStorage.getItem('learnloop_waitlist') || '[]');
      if (!list.includes(email.trim())) list.push(email.trim());
      localStorage.setItem('learnloop_waitlist', JSON.stringify(list));
      setTimeout(() => setState('done'), 600);
    } catch (err) {
      setState('error');
      setError('Something went wrong. Try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{background:'rgba(14,26,31,0.45)', backdropFilter:'blur(6px)'}}
      onClick={onClose}
    >
      <div
        className="paper-card w-full max-w-md p-6 md:p-7 relative"
        style={{boxShadow:'0 24px 60px -20px rgba(14,26,31,0.35)'}}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-ink-900 hover:bg-paper-100 transition"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>

        {state === 'done' ? (
          <div className="text-center py-2">
            <div className="mx-auto w-10 h-10 rounded-full flex items-center justify-center"
                 style={{background:'#E8F6F2', color:'#0E7B7A'}}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M4 10.5l3.5 3.5L16 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="mt-4 font-serif text-2xl text-ink-900">You're on the list.</div>
            <p className="mt-2 text-ink-500 text-sm">
              We'll email <span className="text-ink-900">{email.trim()}</span> when closed beta opens up a spot.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="meta mt-5 inline-flex items-center gap-2"
              style={{color:'#0E7B7A'}}
            >
              Close <span aria-hidden>→</span>
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="meta mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{background:'#1FA29A'}} />
              Closed beta
            </div>
            <div className="font-serif text-2xl md:text-[26px] text-ink-900 leading-tight">
              Join the waitlist
            </div>
            <p className="mt-2 text-ink-500 text-sm">
              We'll email you when your team's invite is ready.
            </p>

            <input
              ref={inputRef}
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@team.com"
              className="mt-5 w-full rounded-md border hairline-strong bg-paper-50 px-3.5 py-3 text-ink-900 placeholder:text-ink-400 font-mono text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1FA29A]/30 focus:border-[#1FA29A]"
            />
            <button
              type="submit"
              disabled={!valid || state === 'submitting'}
              className="mt-3 w-full rounded-md px-5 py-3 font-medium text-sm tracking-wide transition disabled:opacity-50 disabled:cursor-not-allowed"
              style={{background:'#0E1A1F', color:'#FAFBFB'}}
            >
              {state === 'submitting' ? 'Joining…' : 'Submit'}
            </button>
            {error && <div className="mt-2 text-[12px]" style={{color:'#E26F95'}}>{error}</div>}
            <div className="mt-3 meta text-[10px] text-ink-400 text-center">
              No spam. One email when your invite is ready.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

window.Hero = Hero;

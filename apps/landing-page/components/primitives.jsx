/* Shared primitives */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

function Logomark({ size = 32, className = '' }) {
  const w = size * 1.6;
  return (
    <svg width={w} height={size} viewBox="0 0 64 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="ll-loop" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0E7B7A" />
          <stop offset="0.55" stopColor="#1FA29A" />
          <stop offset="1" stopColor="#2BC68A" />
        </linearGradient>
      </defs>
      <circle cx="18" cy="20" r="13" fill="none" stroke="url(#ll-loop)" strokeWidth="5" />
      <circle cx="46" cy="20" r="13" fill="none" stroke="url(#ll-loop)" strokeWidth="5" />
    </svg>
  );
}

function Wordmark({ size = 18 }) {
  return (
    <span className="flex items-center gap-2.5 select-none">
      <Logomark size={26} />
      <span className="font-serif tracking-tight text-ink-900" style={{ fontSize: size + 6 }}>
        LearnLoop
      </span>
    </span>
  );
}

function SectionKicker({ children }) {
  return <div className="section-rule meta">{children}</div>;
}

function SectionTitle({ children, className = '' }) {
  return (
    <h2 className={`h-section mt-5 text-balance font-serif text-[64px] leading-[1.0] tracking-tight text-ink-900 ${className}`}>
      {children}
    </h2>
  );
}

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) el.classList.add('in-view'); });
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Reveal({ children, className = '', delay = 0 }) {
  const ref = useReveal();
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function LiveDot({ label = 'LIVE' }) {
  return (
    <span className="inline-flex items-center gap-2 meta">
      <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full" style={{background:'#2BC68A'}} />
      <span className="text-ink-400">{label}</span>
    </span>
  );
}

function Orbs({ variant = 'hero' }) {
  const cfg = variant === 'hero' ? [
    { c:'#FBE7B5', size:380, x:'52%', y:'-12%' },
    { c:'#D9D2EC', size:420, x:'92%', y:'42%' },
    { c:'#C7EBD9', size:360, x:'-8%', y:'78%' },
    { c:'#CDE0F0', size:300, x:'-4%', y:'8%' },
  ] : [
    { c:'#C7EBD9', size:300, x:'90%', y:'10%' },
    { c:'#D9D2EC', size:340, x:'-6%', y:'82%' },
  ];
  return (
    <div className="orbs">
      {cfg.map((o, i) => (
        <span key={i} className="orb"
          style={{ background: o.c, width: o.size, height: o.size, left: o.x, top: o.y, transform: 'translate(-50%, -50%)' }} />
      ))}
    </div>
  );
}

function Container({ children, className = '' }) {
  return <div className={`max-w-[1200px] mx-auto px-5 md:px-8 ${className}`}>{children}</div>;
}

Object.assign(window, { Logomark, Wordmark, SectionKicker, SectionTitle, Reveal, LiveDot, Orbs, Container });

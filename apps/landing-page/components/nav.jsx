function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    ['Problem',  '#problem'],
    ['Solution', '#features'],
    ['Demo',     '#demo'],
  ];

  return (
    <header className={`sticky top-0 z-50 transition-all ${scrolled ? 'backdrop-blur-md bg-paper-50/85 border-b hairline' : ''}`}>
      <Container className="h-16 flex items-center justify-between">
        <Wordmark />
        <nav className="hidden md:flex items-center gap-1">
          {links.map(([l, h]) => (
            <a key={l} href={h} className="px-3 py-2 text-sm text-ink-500 hover:text-ink-900 transition-colors">{l}</a>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-3">
          <img src="assets/polihack-mark.png" alt="PoliHack v19" className="h-7 w-auto rounded-sm" />
          <span className="w-px h-5 bg-ink-300/40" />
          <img src="assets/bmw-logo.png" alt="BMW" className="h-7 w-auto rounded-sm" />
        </div>
      </Container>
    </header>
  );
}

window.Nav = Nav;

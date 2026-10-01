function Footer() {
  return (
    <footer className="relative py-10 md:py-12 border-t hairline">
      <Container className="flex flex-col md:flex-row items-center justify-between gap-4">
        <Wordmark />
        <div className="meta text-ink-400 text-center">
          PoliHack v19 · BMW · AppDev with AI · "Applications that encourage AI adoption"
        </div>
        <div className="meta text-ink-400 flex items-center gap-3">
          <a href={REPO_URL} className="hover:text-ink-900 transition-colors">GitHub</a>
          <span aria-hidden>·</span>
          <a href={`${REPO_URL}/blob/main/LICENSE`} className="hover:text-ink-900 transition-colors">MIT</a>
          <span aria-hidden>·</span>
          <span>© 2026 LearnLoop</span>
        </div>
      </Container>
    </footer>
  );
}

window.Footer = Footer;

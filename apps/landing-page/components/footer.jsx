function Footer() {
  return (
    <footer className="relative py-10 md:py-12 border-t hairline">
      <Container className="flex flex-col md:flex-row items-center justify-between gap-4">
        <Wordmark />
        <div className="meta text-ink-400 text-center">
          PoliHack v19 · BMW · AppDev with AI · "Applications that encourage AI adoption"
        </div>
        <div className="meta text-ink-400">© 2026 LearnLoop</div>
      </Container>
    </footer>
  );
}

window.Footer = Footer;

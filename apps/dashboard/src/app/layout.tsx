import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trailhead — prompt-skill coach',
  description: 'L1→L2 progression for software teams. PoliHack 2026.',
};

// Top-level shell. Forces dark mode on <html> (the demo machine projects
// best in dark) and renders a sticky nav across all pages.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
          <div className="container flex h-14 items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              Trailhead
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/skill-arc" className="hover:text-foreground transition-colors">
                Skill arc
              </Link>
              <Link href="/team" className="hover:text-foreground transition-colors">
                Team
              </Link>
              <Link href="/wiki" className="hover:text-foreground transition-colors">
                Wiki
              </Link>
            </nav>
            <div className="ml-auto text-xs text-muted-foreground">
              Acme Fintech · demo
            </div>
          </div>
        </header>
        <main className="container py-8">{children}</main>
      </body>
    </html>
  );
}

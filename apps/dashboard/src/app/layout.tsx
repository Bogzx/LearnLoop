import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'LearnLoop — prompt-skill coach',
  description: 'L1→L2 progression for software teams. PoliHack 2026.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
          <div className="container flex h-14 items-center">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" className="block h-7 w-auto" />
              <span>LearnLoop</span>
            </Link>
          </div>
        </header>
        <main className="container py-8">{children}</main>
      </body>
    </html>
  );
}

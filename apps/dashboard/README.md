# dashboard — Next.js on Vercel

Visual proof of behavior change. Skill arc, L1→L2 metrics, wiki tree view.
Closes the demo with a real `/score`-driven tick layered on top of seeded data.

**Tech:** Next.js 15 + Tailwind + shadcn/ui on Vercel.

**Pages:**
- `/`          — demo team selector ("Acme Fintech")
- `/skill-arc` — per-engineer progression chart (reads `skill_observations`)
- `/team`      — L1→L2 progression, reuse rate
- `/wiki`      — node tree + durable learnings view

**Reads from:** `apps/api` only (no direct DB access from dashboard).

**Spec refs:** §2, §11 (seeding), §13 (demo storyboard close)

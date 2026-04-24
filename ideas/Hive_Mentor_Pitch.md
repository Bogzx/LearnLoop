# Hive — Mentor Pitch Script (Adoption-Framed)

> Purpose: explain Hive to a mentor in 3 minutes, in pure adoption language, so they never get the chance to say "this is AI engineering, not AI adoption."

---

## Opening line (the one that blocks the "this is engineering" reflex)

**"We're solving an AI adoption problem, not an AI engineering one — let me show you the data we found."**

Rules:
- Do NOT say "we built" or "our platform" first.
- Do NOT mention the tech stack in the opening.
- Do NOT use the word "AI" as a subject — use "adoption" as the subject.

---

## 1. The problem — ~60 seconds spoken

> "The brief is explicit: AI adoption isn't tool usage — it's a behavioral shift. It calls L1→L2 the hardest transition and warns against the 'tool rollout fallacy.' We took that seriously and went to find where adoption actually stalls for engineers.
>
> Three things we found:
>
> 1. **Individual adoption is saturated.** Stack Overflow's 2025 survey says 76% of software engineers use AI every day. The 'get engineers to try AI' problem is solved. L1 is done.
> 2. **Team adoption is almost nonexistent.** Fewer than 10% of teams have any systematized AI practice — no shared prompts, no team conventions, no `.prompts/`, no collective review. L2 is where everyone stalls.
> 3. **Reddit and the Anthropic adoption study confirm why.** We read r/ExperiencedDevs, r/cursor, r/ClaudeAI, HN threads, and the Anthropic 80-page study. The complaint is never 'AI doesn't work.' It's 'I use AI alone, my teammate uses AI alone, we solve the same problem twice.' Every session dies in a private browser tab. The team never compounds.
>
> So the problem isn't getting engineers to use AI. It's that engineers use AI in **isolation**, and their teams' collective adoption stays stuck at L1 — no matter how many Copilot seats the company buys. This is the tool rollout fallacy the brief warns about, made concrete."

---

## 2. The solution — ~60 seconds spoken

> "We built a **behavioral intervention**, not an AI tool. The purpose is to change HOW teams use AI — from individual to collective — passively, with no new habits required.
>
> The mechanic:
> - Your individual AI work continues normally.
> - With your consent, your AI sessions become discoverable to teammates.
> - When a teammate is about to ask something similar, they see your past session first.
> - Over time, the shared history auto-distills into a living team wiki — a Karpathy-style LLM-OS, but for teams.
>
> The adoption shift:
> - **Before:** 10 engineers, 10 isolated workflows, zero team learning. Stuck at L1.
> - **After:** 10 engineers, one compounding team AI memory. Promoted to L2.
>
> What we deliberately did NOT build:
> - Another AI code generator — the brief calls this the anti-pattern.
> - Training content — the brief says training isn't behavior change.
> - A manual prompt library — those die in two weeks.
>
> We built a passive behavior-change system. The adoption shift happens without asking engineers to change their daily work — only what happens to the knowledge they already produce."

---

## 3. The measurement angle — ~20 seconds spoken

> "Because the brief stresses measurement, we track three adoption metrics — not engineering ones:
>
> 1. % of sessions reused by a teammate.
> 2. Count of prompts promoted from individual use to team template.
> 3. Team-level L1→L2 progression score over time.
>
> Every one of those is a behavior-change metric. None of them are lines-of-code or PR-throughput. That's the proof it's adoption work, not engineering work."

---

## 4. Defense scripts for likely mentor pushback

### "Isn't this just AI engineering with an adoption sticker?"
> "Swap any LLM in — the adoption loop works identically. The AI is infrastructure; the behavior change is the product. Our primary KPI is the percentage of engineers whose knowledge gets reused by teammates — that's a behavioral metric, not an engineering one. And the brief explicitly says we don't even need to use AI at all to win, as long as we drive adoption."

### "Why wouldn't a team just use Notion or a Slack channel?"
> "Because they don't. We checked — teams with access to Notion still don't document AI sessions. Friction is too high, incentive too weak. Our intervention is passive: engineers do zero extra work, but team-level behavior changes anyway. That's the breakthrough — making L2 systematization happen without asking anyone to do it manually."

### "Isn't L0→L1 the winning strategy per the brief?"
> "For most audiences, yes — and if our audience were MEP or civil engineers, we'd target L0→L1. But we picked software engineers, and they're already at L1 at 76% daily use. For our audience the available jump is L1→L2 — which the brief itself calls the hardest transition. The brief also says any +1 jump wins; we chose the one that's actually still there."

### "How is this different from Cursor / Copilot team features?"
> "Cursor and Copilot silo your sessions per user on purpose — they're optimizing individual productivity (L1). We're optimizing team systematization (L2). Different adoption level, different KPI, different product."

### "What proves this drives adoption, not just 'nice-to-have'?"
> "Three adoption signals baked in: (1) pre-emptive search surfaces past sessions before teammates re-ask, so reuse is measurable; (2) prompt graduation from individual to team template is automatic and countable; (3) wiki completeness is a direct proxy for collective L2 systematization. Every one is a measurable behavior shift the brief asks for."

### "Aren't privacy concerns going to block this in enterprises?"
> "Privacy is actually why the passive-intervention model works. We built it European-compliance-first: per-session opt-in by default, automatic PII and secret redaction pre-storage, team-scoped tenant isolation, full user delete rights. That's not a bolt-on — it's the core of why engineers trust the capture step, which is what makes the adoption loop work at all."

---

## Forbidden words and phrases

Don't open with any of these — they trigger the engineering reflex:

- "We built an AI tool that..."
- "Our AI analyzes..."
- "Using LLMs to..."
- "Our platform / our app / our product..."
- Any feature-first sentence

Instead, always open by naming the **adoption problem** or the **behavior** first.

---

## 30-second version (elevator, if they're walking)

> "Software engineers are already at L1 — 76% use AI daily. But <10% of teams have systematized it. The brief calls L1→L2 the hardest transition. We built a passive behavioral intervention: every engineer's AI session compounds into a shared team wiki, so collective team adoption happens without anyone doing extra work. It measures itself — % of sessions reused, number of prompts graduated into team templates. Adoption shift, not engineering."

---

## 10-second version (if they ask what you're working on in the hallway)

> "A team adoption loop — individual AI use automatically compounds into shared team intelligence, so teams actually move from L1 to L2 without extra work."

---

## Core framing principles to repeat until memorized

1. **Behavior change is the product. AI is infrastructure.**
2. **The KPI is team-level reuse, not code quality.**
3. **Passive intervention > training content.** (The brief explicitly says training doesn't change behavior.)
4. **L1→L2 is the unsolved gap for software engineers.** (L0→L1 is solved.)
5. **The brief says we don't need AI to win** — we happen to use it; we don't have to.

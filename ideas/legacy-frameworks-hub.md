# Legacy Frameworks AI Hub

**Target adoption jump:** L1 → L2 (opportunistic prompting → systematized prompting)
**Audience:** Software engineers maintaining legacy codebases (solo or small team)
**One-line pitch:** *"npm for AI instructions, focused on the stacks the modern ecosystem forgot."*

---

## Core Insight

Modern frameworks (React, Next, SvelteKit) have community-maintained AI layers — cursor rules packs, `AGENTS.md` templates, prompt libraries, few-shot example sets. Legacy stacks (AngularJS 1.x, jQuery, older Rails/Django, older PHP, COBOL, VB.NET, Delphi, Perl, Flash/AS3) don't.

Copilot and Cursor are *actively worse* on legacy code because they keep trying to modernize it. Solo maintainers of legacy code don't have a team to share prompts with — **we give them one**.

---

## Product Shape

### 1. CLI: `npx legacystack init`
- Detects the stack in the repo (AngularJS 1.x? old Rails? jQuery-heavy?)
- Installs a matching community pack into the right config file of the right AI tool:
  - `.cursorrules`
  - `AGENTS.md`
  - `copilot-instructions.md`
  - Prompt library folder

### 2. Web Hub
- Browse packs per stack
- Ownership, versions, upvotes, change history
- Anyone can PR a better rule

### 3. Pack Contents
- Rules file (tool-specific)
- 5–10 curated few-shot examples pulled from real legacy patterns
- "What *not* to suggest" negative prompts (e.g., *"do not rewrite this to React"*)

---

## Why This Is Genuinely L1 → L2

L2 in the brief = *"prompts and instructions versioned so others can reuse them."*

The reframe — **"the community is the team for solo legacy maintainers"** — is defensible because the artifact (the pack) has ownership, version history, and reuse. That's the L2 definition, regardless of whether the "team" is 5 coworkers or 500 strangers.

**Pitch it explicitly:** *"Solo maintainers of legacy code don't have a team to share prompts with. We give them one."*

---

## Demo Plan

1. Show a legacy repo (e.g., AngularJS 1.x app)
2. Show Copilot/Cursor giving bad suggestions on it (trying to modernize to React)
3. Run `npx legacystack init` — detects the stack, installs community rules
4. Show Copilot/Cursor now giving stack-appropriate suggestions
5. Show the contributor side: another engineer added a better rule, it gets upvoted, PR'd in
6. End with stats: "5 stacks, 42 prompt packs, 120 contributors" (seeded)

**Two-persona narrative (required for credible L2):**
- Alice — solo AngularJS maintainer *using* a pack
- Bob — another maintainer somewhere *contributing* an improvement that Alice picks up next update

---

## Limitations & Risks

- **Crowded-ish space.** `cursor.directory`, `awesome-cursorrules`, PromptHub all exist. Differentiator *must* be the legacy focus — not "prompts in general."
  - If a judge asks "how is this different from cursor.directory?", answer: *"they optimize for popular stacks; we optimize for the stacks AI is worst at."*
- **Cold-start problem.** A demo with 2 packs and 3 contributors looks dead.
  - **Mitigation:** seed 5–8 high-quality packs for 2–3 stacks before the demo. Show contribution flow with a realistic PR, not an empty registry.
- **"Why not just a GitHub repo?"** Answer: the CLI + auto-detection. The value is frictionless install into the right config file of the right AI tool. Demo that, not the hub.
- **Don't claim to revive dead frameworks.** Honest audience is people *maintaining* legacy code today — banks, insurance, government, older SaaS. "Reviving Flash" is not the pitch.
- **Pick 2–3 stacks, not 10.** Candidates with real maintainer bases:
  - AngularJS 1.x
  - jQuery
  - Older Laravel / PHP
  - Rails 3–4
  - Old .NET Framework
  - Delphi

---

## Risk Comparison vs. CAD/MEP Retrofit Idea

| Dimension | Legacy Frameworks Hub | CAD/MEP Retrofit |
|---|---|---|
| Integration risk | Low (text files, CLIs) | High (plugin SDKs) |
| Demo credibility | Strong if seeded | Strong if licenses available |
| Judge relatability | High (judges are devs) | Medium (niche audiences) |
| Saturation | Medium (prompt hubs exist) | Low (unique angle) |
| Team skills fit | Likely yes | Depends |

---

## Open Questions

- Which 2–3 legacy stacks does the team have hands-on experience with?
- Which AI tool to target first (Cursor? Copilot? Claude Code AGENTS.md?) — pick one for the demo.
- How to handle pack quality / moderation at scale (post-hackathon concern, but worth a slide).

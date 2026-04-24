# AI Adoption for Engineers – From Tools to Transformation

This hackathon focuses on **AI adoption as a fundamental shift** in how engineering work is done — not just on learning new tools. AI changes how engineers think, collaborate, design systems, and take responsibility for outcomes. The goal is to explore what it truly means to become an **AI‑native engineer and organization**.

---

## AI Adoption Is Not Tool Usage

Adopting AI is a **mindset and operating‑model change**. While tools like Copilot or LLMs are enablers, real adoption happens when engineers change *how* they work:

- How they decompose problems
- How they delegate work to machines
- How they review outputs
- How accountability is shared between humans and AI systems

Engineering roles evolve: engineers move from implementing / developing everything themselves to **designing intent, guardrails, interfaces, and feedback loops**. Responsibilities expand from *code ownership* to *system behavior ownership*.

---

## Why AI Adoption Must Be Measured

Without measurement, AI adoption remains a one‑time experiment. Many organizations observe a usage spike during training weeks, followed by a decline once novelty fades. **Sustainable adoption requires understanding whether behaviors actually changed.**

Meaningful signals include:

- Frequency of AI‑assisted workflows
- Quality improvements
- Cycle‑time reduction
- Team‑level collaboration patterns
- Retention of new ways of working

Measurement enables **course correction and scaling**.

---

## The Three Phases of AI Adoption

AI adoption happens in three distinct phases, each with different challenges and success criteria:

### 1. Individual Enablement — *x‑times engineers*
Engineers learn to use AI to accelerate personal productivity. The focus is on skill building, experimentation, and confidence.

### 2. Team Transformation — *x‑times teams*
Teams redesign workflows to work *with* AI. This includes shared conventions, reviews, interfaces, and collective ownership of AI‑assisted outputs.

### 3. Organizational Scaling — *x‑times company*
Successful team patterns are scaled across the organization. Processes, incentives, governance, and platforms evolve to support AI‑native work at scale.

---

## Common Misconceptions and Challenges

- **The lighthouse case**: Pointing to success stories from companies like Google or Walmart is inspirational but rarely actionable. If practices cannot be translated to a specific business context, their ROI is irrelevant.
- **The tool rollout fallacy**: Rolling out AI tools alone does not change behavior. Just as owning a treadmill does not improve health, access to AI does not automatically improve engineering outcomes.
- **The use‑case problem**: AI is a general‑purpose technology. People struggle to extrapolate from generic use cases to their own work. Like electricity, its value emerges when people redesign processes around new capabilities.
- **The AI champion myth**: Training a few experts does not create organizational change. Learning content is not the same as behavioral change. Sustainable adoption requires hands‑on practice, coaching, grassroots momentum, and feedback systems — as illustrated by real adoption data.

---

## What This Hackathon Is About

This hackathon is a **safe environment to experiment with AI‑native ways of working**. Participants are encouraged to:

- Challenge assumptions
- Redesign workflows
- Explore how engineers and AI agents can collaborate effectively

The focus is **not on perfect solutions**, but on learning *how adoption happens*.

---

## AI Adoption Levels

Consider the following levels describing AI adoption in an organization:

| Level | Name | Description |
|-------|------|-------------|
| **L0** | No observable AI use | Engineers implement everything |
| **L1** | Opportunistic prompting | *Personal use:* Engineers use AI tools locally, but no traces exist in the code |
| **L2** | Systematized prompting | *Team use:* Prompts and instructions are versioned so others can reuse them |
| **L3** | Agent‑based development | *AI does specific tasks:* The repository contains agents performing distinct jobs |
| **L4** | Orchestrated agentic workflows | Multiple AI agents/tools are coordinated via workflows or DAGs to automate complex tasks |

---

## The Challenge

> Your task is to **design and implement a technical solution that allows engineers or engineering teams to progress from one adoption level to the next**.

---

## Organizer Briefing — Key Points from the Kickoff

The following notes come directly from the organizer's opening talk and clarify how the challenge will actually be judged and scoped.

### Judging Strategy (read this first)

- **L0 → L1 is an explicitly valid — and often winning — strategy.** Do not feel pressured to build something that jumps from L3 to L4. That is described as **a trap** (*"capcană"*): ambitious but rarely executed well in a hackathon timeframe.
- **Paradox, stated literally by the organizer:**
  > *"You don't even need to use AI in your application, and you can still win the competition — as long as your application helps drive AI adoption."*
- Scoring uses the **standard PoliHack rubric**.
- **10 mentors** are available on site — use them.

### Scope Is Broader Than It Looks

- **Not restricted to mobile apps.** The mobile-only constraint was intentionally removed to push creativity. Valid form factors include:
  - Web apps
  - Desktop apps
  - CLI tools
  - IDE extensions (e.g., VS Code)
  - Smartwatch apps
  - Hardware integrations
- **Target audience is your choice:**
  - An **individual** engineer learning to use AI, **or**
  - A **team / company** adopting AI at an organizational level.
- **Engineering ≠ only software.** Solutions targeting other engineering fields are encouraged:
  - MEP / building-installations engineering
  - Civil / construction engineering
  - Automotive / mechanical engineering
  - Architecture

### Concrete Example Ideas (from the organizer)

- An **MEP / installations engineer** who today searches EU standards by name using their mouse → a focused ChatGPT-style assistant that surfaces the right standard. *(L0 → L1)*
- A **VS Code extension** that teaches developers about **context windows** and **token efficiency**, nudging them from ad-hoc prompting toward structured prompting. *(L1 → L2, opportunistic → systematized)*
- A **model-routing guide or tool** that helps users decide when to use an advanced paid model vs. a free one, based on task complexity.
- A **mini "AI adoption audit" service** — inspired by a previous PoliHack winning-style project — that visits an organization, identifies where AI fits, and trains its people.

### Anti-Pattern — What *Not* to Build

- *"An AI app that tells you what to eat from your fridge."* This is called out explicitly as **not a real problem**. Solutions should address real engineering pain, and someone must plausibly *use* what you build.

### Background Data Worth Referencing

- **Anthropic** has published an ~80-page study on AI adoption, with graphs and data. Recommended reading — and feel free to use AI itself to summarize it.
- US AI adoption is cited at roughly **~20%**.
- **European adoption is worse** than US adoption — your solutions land in a market that is behind the curve.

---

## TL;DR

1. Pick a concrete engineering audience (software or otherwise).
2. Identify which **adoption level** they are at today.
3. Ship a solution that moves them **one level up** — even L0 → L1 is a winning target.
4. Make sure a real person would actually use it.
5. You don't even have to use AI in the solution itself. You just have to help AI adoption happen.

# Changelog

## 0.1.0 — unreleased (to be tagged `v0.1.0`)

The first versioned release: the browser and VS Code extensions are packaged
and attached to the GitHub release. Changes since the PoliHack build, by pull
request:

- **#19 (2026-08-17) Audit fixes.** Revived the API (every LLM call was in an
  infinite recursion), closed the `GET /teams` token leak, made self-hosting
  the default with `docker compose`, added wiki export.
- **#20 (2026-09-30) Hardening.** Server-minted, hashed team secrets;
  tenant-isolation integration tests; the extension calls the API from its
  service worker (Chrome Local Network Access); rate limits; fencing of
  team-written text; the scoring eval harness.
- **#21 Landing page.** The waitlist, which only wrote to the visitor's own
  `localStorage`, is replaced by links to the code, the self-hosting guide and
  the demo; feature claims match the code.
- **#22 API structure.** `app.ts` split into route modules; one Gemini client
  for every call; dead learning-extraction code removed.
- **#23 Keyless demo.** `TRAILHEAD_LLM=offline` runs the stack with no model,
  using a rule-based scorer that is measured on the golden set and a held-out
  set in CI; seeded demo data (`docker compose --profile demo up`); a switch
  for the public demo team; a `docker compose` smoke test in CI.
- **#24 Distribution.** Extension icons and packages, a `package` CI job and a
  tag-triggered release workflow; MCP configs without machine-specific secret
  paths; a coaching directive that adds to the agent's tools instead of
  overriding them.
- **#25 Try it and docs.** The landing page scores prompts in the browser; the
  README gains an architecture diagram and loses its stale claims.

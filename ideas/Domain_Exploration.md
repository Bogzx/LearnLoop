# Cross-Domain Idea Exploration — Maximum Uniqueness

> Previous docs explored MEP (NormativAI) and software engineering (Glass, Aegis). This doc scans *every* engineering discipline for Romanian-specific gaps and ranks by uniqueness — the axis on which this hackathon is actually decided once the theme bar is cleared.

---

## 0. Why Uniqueness Dominates

The organizer said the quiet part out loud twice in the kickoff:

> *"Toată lumea face aplicații cu un pic de AI [...] și nimeni nu le folosește."* (Everyone builds AI apps, nobody uses them.)
> *"Paradoxul e că nici nu trebuie să folosiți AI."* (The paradox is you don't even need to use AI.)

Translation: **everyone will clear the theme bar.** Once that's true, scoring collapses to innovation + execution + presentation. The fastest way to win innovation points is to pick a persona and domain *no other team is going to pick*.

MEP is too obvious — he named it. Software engineering is too obvious — the room is full of CS students. The win is in a domain that:
- Has a real, named Romanian user at L0,
- Is dense with regulations nobody ships AI over,
- Has a visceral single-moment demo,
- Scales to a real market after the hackathon,
- Uses our software-engineering skills to *build* even if the user isn't a software engineer.

---

## 1. The Full Domain Scan

All scored on five axes out of 5. `Uniq` = how unlikely another PoliHack team picks this. `RegW` = regulatory-corpus weight (L0→L1 drivers). `Demo` = how visceral a single demo moment can be. `RO` = how distinctly Romanian. `TAM` = rough domestic market size of the target persona.

### 1A. Engineering disciplines the brief explicitly invites

| # | Domain | Uniq | RegW | Demo | RO | TAM | Notes |
|---|---|---|---|---|---|---|---|
| 1 | MEP / building services | 2 | 5 | 4 | 5 | 5 | The organizer's own example → everyone picks this. NormativAI territory. |
| 2 | Civil / construction | 2 | 5 | 4 | 5 | 5 | Overlaps MEP heavily in corpus. |
| 3 | Architecture | 3 | 5 | 4 | 5 | 4 | Less crowded than MEP; OAR corpus is real. |
| 4 | Automotive / mechanical | 3 | 4 | 3 | 4 | 5 | Dacia / Ford Craiova / Aerostar → huge but diffuse. |
| 5 | Software engineering | 1 | 3 | 4 | 2 | 5 | Hackathon is full of CS students; crowded pick. |

### 1B. Engineering disciplines the brief *allows* but nobody will reach for

| # | Domain | Uniq | RegW | Demo | RO | TAM | Notes |
|---|---|---|---|---|---|---|---|
| 6 | **UAV / drone operations** | 5 | 5 | 5 | 5 | 4 | AACR + NOTAM + RO no-fly = a map + a question = an irrefutable demo. Booming commercial ops market. |
| 7 | **Electric grid / DEER / Transelectrica** | 5 | 5 | 4 | 5 | 5 | PE codes, NTE, N-1 analyses. PNRR is throwing billions at grid. Engineers at DEER/Transelectrica are at L0. |
| 8 | **Cadastre / surveying (ingineri cadastrali)** | 5 | 5 | 4 | 5 | 4 | PNCCF national programme. Law 7/1996. Surveyors grep PDFs and call ANCPI all day. |
| 9 | **Railway / CFR infrastructure** | 5 | 5 | 4 | 5 | 4 | PNRR modernization wave; EN 50126/128/129 RAMS; SRTF spec library. |
| 10 | **Cultural heritage restoration** | 5 | 5 | 4 | 5 | 2 | INP, OAR, Law 422/2001. Utterly unserved globally, not just Romania. Small TAM but massive prestige halo. |
| 11 | **Forestry (ingineri silvici)** | 5 | 4 | 4 | 5 | 4 | Codul Silvic, SUMAL 2.0, Inspectorul Pădurii. Field-based, phone-first, offline-probable. |
| 12 | **Aviation maintenance (EASA Part 145)** | 4 | 5 | 3 | 4 | 3 | TAROM, Blue Air, Aerostar. Forced-local AI case (regulated, safety-critical). |
| 13 | **Nuclear engineering (Cernavodă)** | 5 | 5 | 3 | 4 | 2 | CNCAN regs, extremely regulated. Forced L0. Political risk in demo. |
| 14 | **Automotive homologation (RAR)** | 4 | 5 | 3 | 5 | 3 | RAR rules + EU type approval + RO specifics. |
| 15 | **Welding / NDT inspectors (ISCIR)** | 4 | 5 | 3 | 5 | 3 | ISCIR regs, SR EN ISO 3834, SR EN 9712. Truly L0. |
| 16 | **Water / sanitation (Apa Nova, RAJA)** | 4 | 5 | 3 | 5 | 4 | STAS water standards, NP norms. Another PNRR wave. |
| 17 | **Naval / Danube shipping engineers** | 5 | 4 | 4 | 5 | 2 | Constanța + Danube Commission. Very under-served. |
| 18 | **Mining / extraction geologists** | 5 | 4 | 3 | 5 | 2 | Jiu Valley legacy + new exploration. Law 85/2003. |
| 19 | **Industrial automation (PLC / SCADA)** | 4 | 4 | 4 | 4 | 4 | Siemens / Schneider partners in RO manufacturing. |
| 20 | **Fire safety / IGSU (P118 specialists)** | 4 | 5 | 4 | 5 | 3 | P118 + Law 307/2006. Partly inside MEP, but specialised enough to separate. |
| 21 | **Environmental engineering (ANPM)** | 4 | 5 | 3 | 5 | 3 | EIA, Natura 2000, OUG 195/2005 environmental assessments. |
| 22 | **Telecom / ANCOM engineering** | 4 | 4 | 3 | 5 | 3 | RF planning, ANCOM licensing, 5G deployment. |

### 1C. Dimensions that are not a "domain" but a "cut"

| # | Cut | Uniq | Demo | RO | Notes |
|---|---|---|---|---|---|
| 23 | **Offline / air-gapped engineers** (any domain) | 5 | 5 | 4 | Glass angle. Works across banking, defense, healthcare. |
| 24 | **Older engineers on WhatsApp only** | 5 | 4 | 5 | The 50+ engineer who will never install VS Code. Form factor = WhatsApp bot. |
| 25 | **Field-based engineers (no desk)** | 5 | 5 | 4 | Foreman, inspector, surveyor, forester. Voice-first or AR. |
| 26 | **Students at Politehnica specifically** | 4 | 3 | 4 | The judges *are* this — meta-reference has pull. |
| 27 | **Cross-border EU-project engineers** (RO-DE-FR std mapping) | 5 | 4 | 3 | Standards translation. Niche but defensible. |

---

## 2. The Uniqueness Filter

Sort the table by (Uniq + Demo + RO) keeping RegW ≥ 4. Top of the list:

1. **Drone operations (UAV)** — 15/15 uniq+demo+RO, RegW=5.
2. **Electric grid** — 14/15, RegW=5.
3. **Cadastre / surveying** — 14/15, RegW=5.
4. **Railway / CFR** — 14/15, RegW=5.
5. **Cultural heritage restoration** — 14/15, RegW=5 — but TAM=2.
6. **Naval / Danube** — 14/15, RegW=4.
7. **Forestry** — 14/15, RegW=4.
8. **Field-based cut × any domain** — 14/15 structurally.

The high-TAM + high-uniqueness intersection is 1/2/3/4. **One of those is the answer.**

---

## 3. Deep Dives — The Five Most Unique Contenders

Each follows: **Persona → Surface → Hidden depth → Why it wins → Risks → Demo beat-by-beat → Pitch anchor.**

---

### 3.1 SkyLex — Pre-Flight Regulatory Copilot for Romanian Commercial Drone Operators

**This is the recommendation.** Read §4 before committing.

**Thesis.** Romanian commercial drone operations are exploding (mapping, surveying, roof/solar/powerline inspection, precision agriculture, media). Every flight requires compliance: AACR regulations, EU 2019/947 (OPEN / SPECIFIC / CERTIFIED categories), NOTAM checks, military/civil airspace geometry, CTR zones around airports, restricted areas (refineries, nuclear, Parliament, prisons), Natura 2000 environmental zones. Today the process is: read AACR website → phone AACR → check NOTAM → cross-reference a printed airspace chart → pray. No AI tool covers Romania. Global drone apps (AirMap, Altitude Angel, UAV Forecast, DJI Fly Safe) are US/UK-anchored and do not ingest AACR decisions.

**Persona — explicit.**
- **Cătălin**, 34, owns `DroneVision SRL`. 3 drones, OPEN A2 + SPECIFIC LUC certifications. Does rooftop inspection for insurers and cadastral work for a topography firm. Every mission: ~90 minutes of compliance research for a 45-minute flight. Hates it. Has considered hiring a compliance intern. Today: **L0**.
- Adjacent personas: **mapping engineers** at cadastral firms (drone + photogrammetry); **infrastructure inspection engineers** (powerline, railway, bridge, tower); **precision-agriculture engineers** at agro-firms (Agricover, MaxAgro); media / event operators needing single-flight permits. Together: thousands of authorised commercial operators in AACR's registry.

**Surface — what the judge sees.**
- Single-page web app (or tablet-optimised). Map of Romania centered on Bucharest.
- Input box: *"Vreau să fac inspecție acoperiș la un hotel lângă Otopeni mâine dimineață."*
- On the map:
  - A pin drops at the hotel.
  - Red shaded overlay: **Otopeni CTR, 8 km radius, no-fly without ATC coordination.**
  - Info panel: "**NU puteți zbura.** Motiv: CTR Otopeni, Cod: AIP RO-ENR-5.1. NOTAM activ: A0123/26 până 12:00 UTC. Penalitate max: 30 000 RON (Art. 8 Decizia AACR 628/2014). Acțiune recomandată: cerere ATC către Otopeni TWR cu 72h în avans; alternativ reprogramare în afara zonei CTR."
- Click a different location in Brașov: *"OK. OPEN A2, 120m AGL max. Nu există restricții speciale. NOTAM: curat. Zbor autorizat."*
- Voice-note / Romanian text input also works — no English required.

**Hidden depth.**
- **RAG over AACR decisions** (public: Decizia 628/2014 + amendments, Decizia 221/2007, DGAvC bulletins).
- **EU 2019/947 + 2019/945 full text** — OPEN, SPECIFIC, CERTIFIED category rulebooks, weight/category decision trees.
- **Airspace geometry** from OpenAIP (free), cross-checked against AIP Romania (official, public).
- **NOTAM feed** — Eurocontrol EAD public data, parsed and geo-indexed.
- **Military / restricted zone overlays** — AIP RO-ENR-5 (public), plus nuclear/oil/refinery buffers, plus presidential/parliamentary airspace.
- **Multi-agent verifier** — one agent fetches candidate regulations, a second agent checks the citation back against AIP Romania verbatim, a third agent reasons about conflicts (e.g., SPECIFIC LUC extends OPEN limits in specific geometries). A fourth **penalty agent** produces the enforcement citation so the answer always ends with stakes.
- **MCP server** exposing `check_flight(lat, lon, alt, category, time)` so DJI Fly / Litchi / mission-planner software can call it during mission planning.
- **Explainability** — every answer returns a citation chain: AIP section, AACR decision article, NOTAM id, timestamp of data.

**Why it wins.**
1. **Genuinely globally unique product in Romania.** UpCodes is US, Dlubal is structural, Civils.ai is UK — none touch drone airspace at all. AirMap/Altitude Angel exist but (a) don't speak Romanian, (b) don't ingest AACR decisions, (c) don't cite regs. This is the exact NormativAI market-gap pattern, applied to a domain with a **built-in dramatic demo** (map + pin + red zone).
2. **The demo is iconic.** A judge sees a pin, a red zone, a citation, a penalty number — and *gets it* in 6 seconds. No scrolling through Romanian legal prose required.
3. **Hackathon-buildable corpus.** AIP RO is public. AACR decisions are public PDFs. EU 2019/947 is publicly machine-readable. NOTAM is a free API (Eurocontrol). Unlike NormativAI, there's no ASRO paywall to dance around.
4. **L0→L1 is crystal.** Cătălin's before-state: AACR phone calls. After-state: type question, get answer with cite. No hand-waving.
5. **Presentation gold:** an actual drone on the pitch table. Even as a prop. Even without flying it. The judges remember the team with the drone.
6. **Market math.** AACR registry has on the order of 3 000+ authorised commercial operators. Adjacent operators (surveying firms, insurance drone-inspection contractors, Agricover) multiply the TAM. EU U-space regulation rolls out across 2026 → compliance complexity only grows.
7. **Regulatory tailwind.** EU U-space (Reg. 2021/664 coming into effect in waves), new RO military zones post-2022 (Ukraine proximity), 2024 AACR drone rule refresh.

**Risks and mitigations.**

| Risk | Likelihood | Mitigation |
|---|---|---|
| "A drone is not an engineer" — engineering-track objection | Medium | Frame persona as **UAV mapping / inspection engineer**, not "pilot." Commercial operators with AACR SPECIFIC authorisation are required to demonstrate engineering competency. Open the pitch with: *"a drone operator is a systems engineer — airframe, payload, regulatory, thermodynamic."* |
| Airspace data parsing bugs at demo time | Medium | Pre-cache three demo scenarios: Otopeni CTR, Poiana Brașov uncontrolled, refinery buffer. Play live but retrieve from warm cache. |
| "The organizer wants L0→L1 in an engineering domain and said MEP" | Low | Brief explicitly lists MEP / civil / automotive / architecture **as examples, not as the exhaustive set**. Drone ops is a legitimate engineering niche. Also: the brief says "not restricted to mobile apps" — drone ops is the least-obvious extension. |
| NOTAM / AIP data format surprises | Medium | Chunk the demo: pre-ingest AACR decisions offline; accept NOTAM as a best-effort pulled at demo time with a "cached 15 min ago" label if live fails. |
| Hallucinated penalty numbers | High | Every penalty citation is verified by the penalty agent against a hard-coded table pulled from AACR decisions. No LLM invents a RON amount. |

**Demo beat-by-beat (3 min).**
- 0:00 — Team member holds a drone. "Meet Cătălin. Drone-inspection SRL. Every flight costs him 90 minutes of calling AACR before a 45-minute mission. He's at L0."
- 0:30 — Open SkyLex. Type the Otopeni rooftop inspection query in Romanian.
- 0:55 — Pin drops, red zone appears, penalty citation pops. Read the answer aloud.
- 1:20 — Second query, Brașov location, green zone, authorised. Contrast.
- 1:45 — Third query tries to trick: "Pot să zbor deasupra Cotroceniului la 50 m?" — Red zone, presidential, cite-chain. (Moment of delight.)
- 2:05 — Architecture slide: RAG over AACR + AIP + NOTAM; multi-agent verifier (retrieval → citation-check → contradiction → penalty); MCP server → plugs into DJI Fly / mission planners.
- 2:30 — Market slide: 3 000+ RO commercial operators; EU U-space tailwind; Natura 2000 expansion; zero RO-specific AI competitor.
- 2:50 — Close: *"L0 is Cătălin calling AACR. L1 is Cătălin pointing at the map. That's the entire transition, demonstrated live, shipped."*

**Pitch anchor line.**
> *"The US has UpCodes for buildings. The UK has Altitude Angel for drones. Romania has 3 000 commercial drone operators, a regulator that publishes in PDFs, and no AI tool that speaks Romanian. SkyLex is that tool — and the demo is a pin on a map, not a paragraph."*

---

### 3.2 Rețea — AI Copilot for the Romanian Electric Grid Engineer

**Thesis.** Romania's electricity distribution (DEER — Distribuție Energie Electrică România, E-Distribuție, Delgaz) and transmission (Transelectrica) are in the largest modernization wave in the country's history — billions in PNRR and REPowerEU money, smart-grid deployment, massive interconnector work, renewable integration. The engineers actually doing this work navigate a dense regulatory stack: **ANRE Orders**, the **Code of Transmission Grid (Codul Tehnic al RET)**, the **PE codes** (PE 013, PE 106, PE 107, …), the **NTE norms** (NTE 001, NTE 003, NTE 401, …), plus SR EN 50160, IEC 61850, and project-specific contract clauses. Zero AI tool covers this corpus. Grid dispatchers and project engineers at DEER still PDF-grep.

**Persona.** **Alex**, 38, inginer energetician dispecer at DEER Oltenia. Runs N-1 contingency analyses on 110 kV substations. Today's lookup pattern: open three PE codes, two NTE norms, an ANRE Order, check against project drawings. Estimated 20% of his week is manual regulatory research.

**Surface.**
- Clean Romanian input.
- *"Ce clasă de protecție necesită un transformator 110/20 kV în stație nouă conform PE 103 și cum se corelează cu NTE 003/04/00?"*
- Returns: specific clause from PE 103, the relevant NTE 003 mapping, contradictions flagged (PE codes often pre-date NTE renumbering → real contradiction detector lands).
- Drawings-upload: drop a substation single-line → get compliance flags with regulatory references.

**Hidden depth.** Same RAG + hybrid retrieval + reranker + multi-agent verifier as NormativAI, but over the ANRE / PE / NTE corpus. The **contradiction detector** is genuinely load-bearing here because the RO grid regulatory stack has overlapping, evolving, sometimes contradictory norms from different eras.

**Why it wins.**
1. PNRR tailwind is explicit and large — grid modernization is top-3 priority in RO infrastructure budget.
2. DEER / Transelectrica employ thousands of engineers. Local substation SRLs add thousands more.
3. No competitor (globally, actually — even US-focused tools like Powerex don't do this at the regulation level).
4. The contradiction-detector differentiator is a legitimate feature here, not a nice-to-have.

**Risks.**
- Less visually arresting than SkyLex's map.
- Corpus (PE codes) are dense, older, sometimes scanned — OCR burden real.
- Persona is narrow — engineers at DEER are a focused, reachable audience but the judge may not recognise the title.

**Pitch anchor.**
> *"PNRR spends 4 billion euro on grid modernization. The engineers doing the work still search PE codes with Ctrl+F. We're the seam."*

---

### 3.3 Cadastru.AI — RAG over Romanian Cadastre Law and Procedure for Surveyors

**Thesis.** The **Programul Național de Cadastru și Carte Funciară (PNCCF)** is Romania's most ambitious land-registry project ever, aiming at national cadastral coverage by 2030. Running it: thousands of certified surveyors (ingineri cadastrali autorizaţi) working for ANCPI-registered firms. Regulatory stack: Law 7/1996, ANCPI Orders, specific technical norms (norme tehnice), plus overlaps with urbanism (Law 350/2001) and civil engineering. Today: surveyors phone ANCPI, read long ANCPI PDFs, make mistakes that cost weeks in rejection cycles.

**Persona.** **Ioana**, 30, inginer cadastral autorizat (categoria B) at a Iași-based firm. Files 60+ documentations/month. Estimated 15-20% rejected for procedural mismatch with ANCPI interpretations.

**Surface.** Single-input RO, same shape as NormativAI. "How do I document a dezmembrare for a parcel with an overlapping servitute?" → cited answer from Law 7/1996 + the specific ANCPI Order + example from OCPI guidance.

**Hidden depth.** Same stack. The **procedural-flow agent** is new: given a documentation type, produces a step-by-step checklist with the ANCPI forms and artefacts needed, each step cited.

**Why it wins.**
- PNCCF is a 5+ year national programme with deterministic demand.
- Surveyors are very clearly L0 — field-based work, not tech-forward.
- Domain is narrower than MEP but uncontested.

**Risks.**
- Corpus is huge and partly scanned.
- Demo is less visual than SkyLex.

---

### 3.4 Feroviar.AI — CFR Infrastructure Engineer Assistant

**Thesis.** RO railway infrastructure modernization is a PNRR priority. The engineers doing rehabilitation (CFR SA, Alstom RO, Siemens Mobility partners, ISPCF) live in EN 50126/50128/50129 (RAMS), TSI (EU Technical Specifications for Interoperability), and the SRTF (Specificațiile Tehnice Feroviare — internal CFR norms). No AI tool covers this.

**Persona.** **Andrei**, 41, inginer feroviar at a subcontractor of CFR SA, doing a 300-km rehab line. Each design decision crosses 3-4 norms.

**Why it wins.** PNRR tailwind, regulatory density, complete AI absence. Same pattern as NormativAI with stronger market clock.

**Risks.** Esoteric to non-infra judges; the domain's vocabulary is alien to a CS judge without a story.

---

### 3.5 Restauratorul — AI over Romanian Cultural Heritage Restoration Norms

**Thesis.** Maximum uniqueness score. Romania has UNESCO-listed monuments, wooden churches of Maramureș, Saxon fortified churches, painted monasteries. Heritage restauratori at **INP** (Institutul Național al Patrimoniului), **OAR**, and private workshops live in Law 422/2001, Norme Metodologice, OMC orders, ICCROM guidance. Cross-referencing material specs, historical period norms, site permits, and EU cultural-heritage rules is a mess. No AI tool exists.

**Persona.** **Mihai**, 45, restaurator at INP. Works on a wooden church in Maramureș. Current tools: scanned PDFs of 1970s restoration reports.

**Why it consider-but-probably-not.** Uniqueness is maxed, but TAM is tiny (hundreds of professionals), demo is less visceral, and it reads as a research project more than a product at a hackathon scale. Keep in reserve if we want a "wow" dark horse.

---

## 4. Cross-Domain Structural Plays

These are *cuts* that overlay on any domain — they are dimensions, not specialities, and deserve consideration in their own right.

### 4.1 WhatsAppBot — Engineer on WhatsApp, any domain

**Idea.** The 50+ Romanian engineer will never install VS Code, Cursor, or a desktop RAG app. They live on **WhatsApp**. A WhatsApp Business bot that:
- Accepts voice notes in Romanian.
- Accepts photos (drawings, panel shots, forms).
- Returns voice notes + a PDF with the cited answer.
- Works across any corpus we plug in (MEP, grid, cadastre, forestry).

**Why it matters.** WhatsApp is *the* platform for Romanian SMEs. Zero-install is a genuine accessibility win. The "AI in your WhatsApp" moment is unusually memorable in a demo.

**Flag.** Feels gimmicky unless paired with a real vertical corpus. **Best as a form-factor layer on top of SkyLex or NormativAI**, not a standalone.

### 4.2 Field — Offline field assistant for engineers with no desk

**Idea.** Inspectors, foremen, surveyors, foresters, grid linemen: they are in the field, often with poor connectivity. Tablet / phone app that runs a distilled local model + vertical corpus offline. Sync when connected.

**Flag.** Combines Glass (offline) + any of the regulated personas. Strong engineering story, slightly harder demo than SkyLex.

### 4.3 AR-Overlay — Point your camera at the thing

**Idea.** Phone/tablet camera pointed at a substation / electrical panel / pipe run / monument → AI overlays component identification + applicable regulatory references.

**Flag.** Visually spectacular demo. Execution risk in 24h is real (CV + AR + RAG). Recommended only if we have a strong CV engineer on the team.

### 4.4 PoliHack Students — Meta-reference play

**Idea.** Politehnica engineering students across all disciplines (mechanical, civil, electrical, chemical, aerospace, …) need help applying AI to *their specific course*, not just generic coding. A tool that ingests their course corpus + textbook + past problems and produces a personalised AI tutor per discipline.

**Flag.** The judges *are* the audience — pull is real. But it reads as an education product, not a professional one. Lower innovation-points ceiling.

---

## 5. Comparative Matrix — Top 5 Uniqueness-First Picks vs. Prior Tops

| Criterion | **SkyLex (drone)** | Rețea (grid) | Cadastru.AI | Feroviar | Glass (offline SWE) | NormativAI (MEP) |
|---|---|---|---|---|---|---|
| Uniqueness at PoliHack | 5 | 5 | 5 | 5 | 4 | 2 |
| Demo visceral | 5 — map + pin + red | 3 — text answer | 3 | 3 | 5 — Wi-Fi off | 4 |
| Persona specificity | 5 | 5 | 5 | 5 | 5 | 5 |
| Regulatory corpus accessibility | 5 — AIP + AACR public | 4 — scanned PE | 4 — ANCPI | 4 — SRTF restricted | n/a | 4 — MDLPA public |
| RO market math | 4 — 3k+ operators, rising | 5 — PNRR | 4 — PNCCF | 4 — PNRR | 5 — forced-buy | 5 |
| Tailwind | 5 — EU U-space | 5 — PNRR | 4 — PNCCF | 5 — PNRR | 5 — NIS2/DORA | 4 — CATUC 2026 |
| Build risk in 24h | 3 — geo layer | 3 — corpus OCR | 3 — corpus OCR | 2 — corpus hard to get | 3 — hardware | 3 |
| Organizer "engineering" legitimacy | 4 — defensible | 5 | 5 | 5 | 5 | 5 |
| "Team next to us builds the same" probability | **low** | low | low | low | medium | high |
| Story memorability | 5 — drone on table | 3 | 3 | 3 | 5 | 4 |
| **Sum of highs** | **44** | 38 | 36 | 36 | 37 | 36 |

---

## 6. Recommendation

### Primary: **SkyLex**

Of everything surveyed, SkyLex has the highest expected outcome because it is the only candidate that simultaneously wins on:

- **Uniqueness** — no other PoliHack team will pick drone regulatory AI. Crowded-pick risk is near zero.
- **Demo gravity** — a map + pin + red zone is the single most readable demo format in the room. Six seconds to *get it*.
- **Corpus accessibility** — AIP Romania, AACR decisions, EU 2019/947, NOTAM are all public + machine-readable. Unlike NormativAI or Rețea, no OCR scramble.
- **Physical prop** — bringing an actual drone onto the stage is a story-device the team down the hall cannot copy.
- **Market credibility** — 3 000+ registered commercial operators + surveying + inspection + precision-agriculture growth + EU U-space rollout = real post-hackathon path.
- **Engineering legitimacy** — commercial drone operations with SPECIFIC/LUC authorisation require demonstrable systems-engineering competency; framing holds.
- **Software-engineering leverage** — we build the geo-layer, the RAG, the multi-agent verifier, the MCP server. Nothing domain-specific that we can't learn in 6 hours from public AIP PDFs.
- **Organizer's implicit approval space** — he said non-software engineering *encouraged* and form factor *unrestricted*. Drone regulatory copilot is in-bounds and unpredicted.

### Secondary: **Rețea**

If SkyLex is blocked (team lacks map/geo appetite, or the "is drone operator engineer?" objection sticks), fall back to Rețea. Same NormativAI shape, less-obvious persona (grid engineer), bigger tailwind (PNRR grid modernization), lower demo drama.

### Tertiary: **NormativAI + WhatsApp form-factor**

If we prefer safer corpus execution, keep NormativAI's MEP corpus but ship the **WhatsApp bot surface** instead of the web app. This single pivot re-uniques a crowded idea: while every other team builds a ChatGPT wrapper for MEP, we are the one that answers voice notes from a 55-year-old MEP engineer on WhatsApp. Form factor = uniqueness here.

### Explicitly not recommended
- **Glass alone** — good idea, medium uniqueness in the hackathon crowd (offline Ollama is well-known). Fold "offline mode" into SkyLex or Rețea as a feature instead.
- **Restauratorul** — maximum uniqueness but TAM too small to tell a good market story, demo less crisp.
- **Software-engineering picks (Aegis, ContextForge, Ledger)** — good ideas, but a CS-student crowd will think of them too. Lower expected uniqueness.

---

## 7. Why SkyLex Beats NormativAI Head-to-Head

The old Winning_Strategy doc's logic for NormativAI still applies to SkyLex — and more.

| Argument for NormativAI | Does SkyLex inherit it? |
|---|---|
| "Organizer named the persona" | No — but organizer did say non-software, non-restricted form factor is *encouraged*, and drone ops is the cleanest extension. |
| "Simple surface, sophisticated brain" | **Inherits fully.** Map + pin = simplest possible surface. Backend is RAG + multi-agent + MCP. |
| "RO-language, RO-regulation gap" | **Inherits fully.** AACR decisions are RO-only. |
| "Live demo survives failure modes" | **Inherits better.** SkyLex's worst case is "map loads, wrong citation" — still a functional product. NormativAI's worst case is "retrieves wrong clause" — credibility hit. |
| "Technical depth is natural" | **Inherits fully + adds a geo-spatial layer the MEP pitch doesn't need.** |
| "Market math is real" | **Inherits differently.** MEP market is bigger; drone market is faster-growing and has EU regulatory clock. |
| **"Team next to us will probably build this"** | **NormativAI: yes.** Organizer named the persona, every team that took notes is considering it. **SkyLex: no.** Not on anybody else's radar. |

The last row is the whole argument. The original strategy doc's own logic says *"the real differentiators become execution quality and innovation — because everyone will clear the theme bar."* The cheapest way to buy innovation points is to pick a domain the room won't touch.

---

## 8. Anti-Patterns This Doc Is Deliberately Avoiding

1. **Fake uniqueness.** "Our spin on MEP is we use a different colour" is not uniqueness. Uniqueness is a persona no other team will name.
2. **Esoteric-for-its-own-sake.** Restauratorul is maximally unique but has no TAM story. Uniqueness without market = art project.
3. **Form-factor gimmicks with no corpus.** WhatsApp bot alone is gimmick. WhatsApp bot + a real vertical corpus (SkyLex via WhatsApp, say) is a product.
4. **Multi-domain platform fantasy.** "One tool that serves every engineering vertical" is the platform-fluff trap. Pick one vertical, win it, *then* platformise in the next-steps slide.
5. **Ignoring the demo moment.** If you can't describe in one sentence what the judge sees in the first 10 seconds, you don't have a demo. SkyLex has it: *"a pin drops, a red zone appears, a penalty number appears."*

---

## 9. Execution Discipline for SkyLex (24h map)

- **H00–H02** — Lock persona (Cătălin), the three demo queries, the exact map locations (Otopeni CTR, Brașov uncontrolled, Cotroceni presidential). Pull AIP RO-ENR-5, AACR Decizia 628/2014, EU 2019/947 PDF to disk.
- **H02–H06** — Corpus chunk + embed + index. Simple FastAPI + MapLibre / Leaflet front-end. Single `/check` endpoint.
- **H06–H10** — Multi-agent chain: retriever → citation-verifier → penalty-agent. Connect to OpenAIP for airspace geometry. Static copy of NOTAM feed for demo (live fetch as stretch).
- **H10–H14** — Polish: three demo queries flow perfectly. Pin drops, red/green zone, citation panel, penalty number.
- **H14–H18** — Architecture slide, persona slide, market slide. Pitch script. One-page web landing with waitlist.
- **H18–H22** — MCP server stub exposing `check_flight(lat, lon, alt, category, time)`. Bonus: integrate with a common mission-planner to flex the L2-ready story.
- **H22–H24** — Rehearse the demo 10× on presentation hardware. Borrow / rent a drone as a physical prop for the pitch table. Cache the three queries so the demo is deterministic.

**Critical discipline:** do not expand scope to "also does NOTAM live," "also does weather," "also does insurance," or "also recommends flight paths." The demo is: **three queries, three pin drops, three answers, one drone on the table**.

---

## 10. Bottom Line

The NormativAI strategy is excellent, but crowded — the organizer named that persona and every attentive team will be drafting it this weekend. Glass is strong but sits in the software-engineering crowd. The highest-expected-value move is to **keep the NormativAI strategy shape (simple surface, sophisticated brain, RO-specific corpus gap, L0→L1 persona, multi-agent verification)** and **move it to a domain no other team will touch: commercial drone operations**.

> **One pin on a map. One red zone. One citation. One penalty. One drone on the table. That's the pitch, and nobody else in Politehnica is writing it this weekend.**

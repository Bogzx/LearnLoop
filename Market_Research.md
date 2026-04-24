# Market Research — NormativAI

> Deep competitive + validation research for an AI assistant over Romanian engineering normatives (MEP / construction / architecture). Focused on the hackathon pitch but written so it also stands up post-hackathon as a commercial case.

---

## 1. Executive Summary

- **Does the product exist?** A mature **global** category of "AI over building codes" exists — led by **UpCodes Copilot**, **Nomic**, **Dlubal Mia**, **Civils.ai**, and several smaller players.
- **Does the product exist for Romania?** **No.** Every mature competitor is English-language and covers either US codes (IBC/NFPA/ADA/OSHA) or generic Eurocodes at the EN level. **None cover Romanian National Annexes (SR EN) or the Romanian technical reglementări (P100, I13, C107, NP, NE, CR, GP, etc.)**. The only "Romanian" AI assistants in the press are general-purpose chatbots (ChatGPT-ro wrappers) or vertical tools in unrelated domains (finance, legal).
- **Is there demand?** Yes, multi-signal. Romania's construction market is projected +9.1% in 2025, 88% of construction firms already use digital tooling, AIIR reports an acute shortage of MEP engineers (productivity pressure), and new regulatory consolidation (CATUC, approved for 2026) creates a compliance-search wave.
- **Bottom line:** the product category is **validated globally** and **unserved locally**. That is the strongest possible pattern for a hackathon pitch — a judge does not have to believe in a new category, only that Romania deserves the same tool others already pay for.

---

## 2. Global Competitive Landscape

Listed roughly by relevance.

### 2.1 UpCodes Copilot (US)
- AI research assistant built on GPT-4, launched 2023. ([UpCodes announcement](https://up.codes/a/introducing-upcodes-copilot), [TechCrunch Series A](https://techcrunch.com/2023/05/30/upcodes-copilot-series-a/))
- Database: **>5M code sections, >1,700 state and city codes, 160,000 local amendments**, updated ~7,000 times/month. ([UpCodes features](https://up.codes/features/ai))
- Free tier: 3 questions. Pro / Enterprise: unlimited. ([Copilot page](https://up.codes/copilot))
- Scope: US-only, English-only. ([GetApp listing](https://www.getapp.com/it-management-software/a/upcodes/))
- Competes with iccsafe.org, nfpa.org, mikeholt.com for traffic. ([CB Insights](https://www.cbinsights.com/company/upcodes/alternatives-competitors))

### 2.2 Nomic (US, AEC vertical AI)
- **380+ building codes**, IBC / NFPA / ADA / OSHA plus local amendments. ([Nomic codes list](https://www.nomic.ai/use-cases/code-compliance-of-drawings/codes))
- Core use case: upload drawings, ask "does this meet egress requirements?", get cited clauses. ([Nomic compliance use case](https://www.nomic.ai/use-cases/code-compliance-of-drawings))
- Positions itself as **domain-specific AI for AEC**, not a general chatbot. ([Nomic homepage](https://www.nomic.ai/))
- US-anchored.

### 2.3 Dlubal Mia (Germany — structural software)
- AI chatbot for structural engineering Q&A, **won 2024 Construction Computing Award – Innovation of the Year**. ([Dlubal Mia page](https://www.dlubal.com/en/support-and-learning/ai-support/mia-your-ai-expert-for-structural-analysis))
- Built on ChatGPT-4, trained on Dlubal's website and docs. ([Dlubal Mia blog](https://www.dlubal.com/en/news-and-events/news/blog/000146))
- Integrated directly into RFEM / RSTAB / RSECTION.
- **Limitation for our thesis:** scope is Dlubal-product support + structural Q&A. Not a general compliance search engine; not Romania-aware.

### 2.4 Civils.ai (UK)
- AI co-pilot for civil engineering, focus on **contracts, tenders, drawings, site investigation PDFs**. ([Civils.ai homepage](https://civils.ai/))
- Pro tier **$250 one-time**, agents priced separately on custom plans. ([Civils.ai pricing](https://civils.ai/pricing))
- Claims Eurocode awareness, but their [Eurocode article](https://civils.ai/blog/ai-for-eurocode-regulations) is marketing prose — **no National Annex support and no concrete Eurocode feature disclosure**.
- **Limitation for our thesis:** does not cover Romanian National Annex; does not cover RO-specific technical reglementări outside Eurocodes (P100 family, I13, C107, NP, NE, CR series).

### 2.5 StructWise (by ai-u.com)
- "AI assistant for structural engineers" providing codes, standards, and guidance answers. ([ai-u.com](https://ai-u.com/en/product/structwise))
- Small player; public detail thin.

### 2.6 Building Regulations Copilot
- Free AI assistant for England, Wales, Scotland, Northern Ireland, Ireland, USA, Australia, Switzerland. ([BRC homepage](https://buildingregulationscopilot.com))
- Romania not in scope.

### 2.7 Other notable players
| Tool | Focus | Notes | Source |
|---|---|---|---|
| **Archistar** | Permit / compliance AI | Real-estate / construction market | [CB Insights](https://www.cbinsights.com/company/upcodes/alternatives-competitors) |
| **Ulama** | Revit plugin for code checks | AI-powered compliance in BIM | [Capterra](https://www.capterra.com/p/169409/UpCodes/alternatives/) |
| **BuildCheck AI** | Preconstruction design checks | AI-native | Capterra |
| **AutoReview.AI** | Automating code reviews | US market | [aichief](https://aichief.com/alternatives/upcodes/) |
| **Codes.IQ (inqi.ai)** | "Context-aware" code compliance | Positions itself against UpCodes | [inqi.ai](https://www.inqi.ai/post/codes-iq-vs-up-codes-why-the-future-of-building-code-compliance-is-context-aware-ai) |
| **CodeComply.ai** | Plan-review software | US | [codecomply.ai](https://codecomply.ai/) |
| **Datagrid** | AI agents for code-requirement extraction | Enterprise | [Datagrid blog](https://datagrid.com/blog/how-ai-agents-automate-building-code-requirement-extraction) |
| **VIKTOR.AI** | Agents + MCP for engineering workflows | [VIKTOR blog on MCP](https://www.viktor.ai/blog/196/how-engineers-can-use-ai-agents-and-mcp-servers-to-work-smarter) |

Academic validation: a 2025 vision-language-model paper on building code compliance — ([Virginia CS](https://www.cs.virginia.edu/~bjc8c/papers/zheng25inspection.pdf)) — and a US DOE 2024 report on AI for energy code compliance ([DOE PDF](https://www.energy.gov/sites/default/files/2024-11/bto-peer-2024-pnnl-ai-for-energy-code-compliance.pdf)) confirm the category is research-respectable, not fringe.

---

## 3. The Romanian Gap (the actual finding)

### 3.1 What exists in Romania
- **General-purpose Romanian LLM wrappers:** ChatGPT-ro, Gemini-ro, Copilot-ro. ([Curs de Guvernare overview](https://cursdeguvernare.ro/inteligenta-artificiala-in-limba-romana-3-instrumente-utile.html))
- **Vertical RO AI assistants in other domains:**
  - **Fonduri-structurale.ro** — "first Romanian platform with an AI assistant specialized in financing sources." ([ProTV coverage](https://stirileprotv.ro/stiri/i-like-ai/fonduri-structurale-ro-lanseaza-prima-platforma-din-romania-cu-asistent-ai-specializat-in-identificarea-surselor-de-finantare.html))
  - **AsistentJuridic / ChatbotJuridic.ro** — legal document analysis.
- **BIM digitalization in MEP design:** **MEP Designer** (Graphisoft, distributed locally by CONSOFT) launched on the Romanian market. ([Agenda Constructiilor](https://www.agendaconstructiilor.ro/stiri/digitalizarea-in-constructii-industrie/mep-designer-noua-solutie-bim-pe-piata-din-romania-pentru-proiectarea-instalatiilor)) — this is BIM modeling, **not** a compliance search engine.
- **CYPE Romania** is planning CAD→BIM transition tooling for 2026. ([Agenda Constructiilor](https://www.agendaconstructiilor.ro/stiri/digitalizarea-in-constructii-industrie/software-bim-constructii-planurile-cype-romania-pentru-2026-si-tranzitia-de-la-cad-la-bim))

### 3.2 What does NOT exist
- **No Romanian-language AI assistant over Romanian construction reglementări.** Confirmed by multiple targeted searches — only general-purpose chatbots surface.
- **No product supports Romanian National Annexes (SR EN) in an AI/RAG fashion.** SCIA Engineer implements NA mappings at the calculation level ([SCIA NA list](https://www.scia.net/en/scia-engineer/fact-sheets/design-codes/implemented-eurocode-national-annexes)), but that's structural software, not natural-language search.
- **No AI tool that indexes RO-specific technical reglementări** (P100-1, P100-3, I13, C107, NP-series, NE-series, CR-series, GP-series). Current access to these is scanned PDFs on MDRAPFP and OAR websites. ([MDLPA technical regulations list](https://www.mdlpa.ro/pages/reglementaritehnice), [OAR normatives page](https://oar.archi/reglementari-tehnice-2/normative-si-standarde/reglementari-tehnice-privind-calculul-constructiilor-si-elementelor-de-constructii/))

This is a textbook **localization + vertical gap** in a validated category.

---

## 4. Romanian Market Validation

### 4.1 Market size and trajectory
- **Construction market growth:** +9.1% forecast for 2025, driven by EU funds and builder professionalization. ([Uniprest 2025 report](https://www.uniprest.ro/wp-content/uploads/2025/08/raport-constructii-instalatii-in-romania-2025.pdf), [Revista Biz](https://www.revistabiz.ro/provocarile-industriei-de-constructii-si-instalatii-din-romania-in-2025/))
- **Sentiment:** 65% of firms expect expansion in 2025. ([Uniprest](https://uniprest.ro/raport-piata-de-constructii-instalatii/))

### 4.2 Digital readiness (the receptive-audience signal)
- **88%** of Romanian construction respondents use digital solutions for monitoring/optimizing installations.
- **66%** prefer remote-control tooling, **60%** automation. ([Uniprest 2025 report](https://www.uniprest.ro/wp-content/uploads/2025/08/raport-constructii-instalatii-in-romania-2025.pdf))
- **80%** cite advanced automation for energy efficiency as a 3–5 year priority.
- Interpretation: the target user already tolerates digital tools — not an L0 market in the "afraid of software" sense, but an L0 market in the "not using AI *yet*" sense. That is **exactly** the organizer's thesis.

### 4.3 User pain — the productivity case
- **AIIR (Asociația Inginerilor de Instalații din România)** — 60 editions of the national conference, >300 specialists at the 2024 edition. ([AIIR](https://www.aiiro.ro/), [CN AIIR 2024](https://www.proidea.ro/evenimente-profesionale-2/conferinta-nationala-a-inginerilor-de-instalatii-din-romania-cn-aiir-2024-editia-59-23341.shtml), [CN AIIR 2025](https://www.revistaconstructiilor.eu/index.php/2025/11/06/aiir-conferinta-nationala-a-asociatiei-inginerilor-de-instalatii-din-romania-editia-60-12-14-octombrie-2025-casino-sinaia/)).
- **"The local market for installations suffers from a lack of engineers, even though salaries are very good."** ([Agenda Constructiilor](https://www.agendaconstructiilor.ro/files/instalatii-de-apa-sisteme-hvac/aiir-piata-de-instalatii-sufera-de-lipsa-de-ingineri-desi-salariile-sunt-foarte-bune.html)) → engineer time is expensive → productivity tools are valued.
- Existing clearinghouses of RO normatives are either paywalled ([ASRO](https://magazin.asro.ro/)) or unstructured scans ([MIGS legislative updates](https://migs.ro/category/legislatie-normative-constructii-instalatii/), [Revista Constructiilor commentary on P100](https://www.revistaconstructiilor.eu/index.php/2020/07/01/observatii-si-propuneri-la-normativele-seismice-p100-1-2013-p100-3-2019/)). Engineers search by browsing PDFs. This is the exact L0 workflow the organizer named in the kickoff.

### 4.4 Costs engineers currently absorb
- **ASRO standards are paywalled.** InfoStandard Web/CLOUD is subscription-based; member discount is 15%. ([ASRO tariffs page](https://www.asro.ro/tarife/), [ASRO standard example](https://magazin.asro.ro/ro/standard/30490))
- **OAR Bucuresti subscribes on behalf of members** for consultation access. ([OAR Bucuresti subscription](https://www.oar-bucuresti.ro/inscriere-standarde/))
- Implication: a tool that indexes the **public subset** (RO reglementări via MDLPA are freely published) and enables natural-language search is immediately useful and does not require a commercial license for that subset.

### 4.5 Regulatory tailwind
- **CATUC** (Codul Amenajării Teritoriului, Urbanismului și Construcțiilor) — a new umbrella construction code, **anticipated for approval in 2026**. ([Piata Financiara](https://www.piatafinanciara.ro/arhitectura-si-constructiile-in-2026-sustenabile-inteligente-si-centrate-pe-oameni/))
  - Every regulatory consolidation event = a spike in "which rule applies now?" queries.
- **New fire-safety reglementări** adopted in 2025.
- **Romania's National AI Strategy 2024–2027** explicitly aligns with EU/NATO/OECD normative frameworks. ([SGG Annex 1](https://sgg.gov.ro/1/wp-content/uploads/2024/07/ANEXA-1-10.pdf), [ADR Strategy](https://www.adr.gov.ro/wp-content/uploads/2024/03/Strategie-Inteligenta-Artificiala-22012024-1.pdf))
- **ASRO/CT 401** exists as a national technical committee on AI standardization. ([ASRO on EU AI regulation](https://www.asro.ro/ue-si-romania-fac-pasi-importanti-in-reglementarea-inteligentei-artificiale/)).

---

## 5. Gap Analysis — where NormativAI wins

| Capability | UpCodes | Nomic | Dlubal Mia | Civils.ai | **NormativAI** |
|---|---|---|---|---|---|
| US codes (IBC, NFPA, ADA, OSHA) | ✅ | ✅ | ❌ | partial | ❌ (out of scope) |
| Eurocodes EN generic | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Romanian National Annex (SR EN)** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Romanian technical reglementări (P100, I13, C107, NP, NE, CR)** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Romanian-language queries** | ❌ | ❌ | ❌ | ❌ | ✅ |
| Citation verification / hallucination guard | partial | ✅ | partial | partial | ✅ (multi-agent verifier) |
| Contradiction detection across standards | ❌ | ❌ | ❌ | ❌ | ✅ (differentiator) |
| MCP surface for IDE/CAD integration | ❌ | ❌ | ❌ | ❌ | ✅ (differentiator) |
| Price fit for RO SMEs | ❌ ($$$) | ❌ ($$$) | bundled | ❌ ($250+) | ✅ (open demo) |

**Positioning line for the pitch:** *"UpCodes exists for the US. Dlubal Mia exists for structural work in German. Nothing exists for the Romanian MEP / civil engineer who opens a scanned PDF of P100 every day. NormativAI is that."*

---

## 6. Similar Romanian Precedents (pattern validation)

These are not competitors — they validate that **"first Romanian AI in vertical X"** is a recognizable, press-worthy pattern:

- **Fonduri-structurale.ro** — AI assistant over Romanian/EU financing programs. Announced as *"first Romanian platform with specialized AI assistant"* by mainstream media. ([ProTV](https://stirileprotv.ro/stiri/i-like-ai/fonduri-structurale-ro-lanseaza-prima-platforma-din-romania-cu-asistent-ai-specializat-in-identificarea-surselor-de-finantare.html))
- **ChatbotJuridic.ro / AsistentJuridic.ro** — RO legal document analysis. ([ChatbotJuridic](https://chatbotjuridic.ro/descopera-puterea-ai-in-analiza-documentelor-asistentjuridic-ro-schimba-regulile-jocului/))
- **Revista Constructiilor** published a 2024 feature on the impact of AI on construction. ([Article](https://www.revistaconstructiilor.eu/index.php/2024/08/07/impactul-inteligentei-artificiale-in-industria-constructiilor/)) — the trade press is primed, not skeptical.

The same "first-in-Romania vertical-AI" slot for **engineering reglementări** is empty.

---

## 7. Risk Matrix

| Risk | Likelihood | Mitigation |
|---|---|---|
| Corpus access — ASRO SR EN is paywalled | High | Scope MVP to **publicly published RO reglementări** (MDLPA-hosted PDFs of P100, I13, C107, NP, NE, CR etc.). Do not ship protected SR EN text — discuss ASRO partnership as the L2 roadmap slide. |
| OCR quality of scanned PDFs | Medium | Use a modern OCR + layout-aware chunking. Hackathon hack: pre-process corpus offline before demo. |
| Hallucinated citations | High (domain risk) | Dedicated **citation-verifier agent** that re-checks each quoted clause against source chunks. This is a feature, not just a fix — it becomes the selling point for an audience that distrusts AI. |
| "An engineer won't trust AI output on life-safety clauses" | High | Two mitigations: (a) always return cited source + page, never synthesize alone; (b) frame the tool as a **search accelerator**, not a **decision-maker**. Engineer still signs. |
| Competitor expands to Romania | Low (short term) | UpCodes/Nomic are US-focused on revenue; RO localization has low priority for them. Civils.ai could plausibly pivot but has no RO-language capability today. |
| LLM costs at demo | Low | Model router (Haiku for retrieval/verification, Sonnet for answers) + query caching — directly matches a virtue the organizer praised. |

---

## 8. Validation Script (what to say at the demo)

**Opening:** *"Raise your hand if you think Romanian MEP engineers are currently using AI to find the right clause in P100 when they design a building."* (No hands.)

**Claim:** *"In the US, UpCodes indexes 5 million code sections and has AI search. In Germany, Dlubal's Mia won Construction Computing's 2024 innovation award. In Romania — the country with +9.1% construction growth this year and 88% digital-tool adoption — zero AI tools exist that read the Romanian normative library."*

**Demo:** live query in Romanian — *"ce clasă de importanță are un spital de urgență conform P100-1?"* — return cited clause from P100-1/2013, 2-line explanation, link to source page. Backed by the multi-agent citation verifier and the MCP server exposure.

**Close:** *"L0 is a Romanian MEP engineer searching scanned PDFs with Ctrl+F. L1 is the same engineer typing a question in Romanian and getting the clause. That's what we built. We also happened to build a RAG + multi-agent + MCP stack behind it — because the organizer told you a shallow solution isn't enough."*

---

## 9. Conclusion — Pitch-Ready Findings

- **Category:** globally validated (UpCodes, Nomic, Dlubal Mia, Civils.ai) and research-respectable (2024–2025 academic papers on building-code AI).
- **Romania:** empty. No RO-language, RO-reglementare-aware AI assistant exists. Adjacent verticals (legal, finance) have "first-in-Romania" AI products in mainstream press.
- **Demand:** +9.1% market growth, 88% digital adoption, engineer shortage, 2026 regulatory consolidation (CATUC), established professional body (AIIR) — every vector points toward a receptive audience.
- **Defensibility in hackathon context:** hitting the L0→L1 theme with a **publicly defensible market gap** is a significantly stronger pitch than "we built a cool agent framework." The judges want *someone who will actually use this*. We can **name the user, name the normative, name the workflow, name the competitor gap, and cite it all**.

**The market research says: build it.**

---

## Sources

- [UpCodes Copilot — feature page](https://up.codes/features/ai)
- [UpCodes Copilot — launch blog](https://up.codes/a/introducing-upcodes-copilot)
- [TechCrunch: UpCodes Copilot Series A](https://techcrunch.com/2023/05/30/upcodes-copilot-series-a/)
- [Facilities Dive: UpCodes AI building codes Copilot](https://www.facilitiesdive.com/news/upcodes-ai-building-codes-copilot-tool/652202/)
- [UpCodes Y Combinator profile](https://www.ycombinator.com/companies/upcodes)
- [UpCodes alternatives — Capterra](https://www.capterra.com/p/169409/UpCodes/alternatives/)
- [UpCodes alternatives — CB Insights](https://www.cbinsights.com/company/upcodes/alternatives-competitors)
- [UpCodes alternatives — aichief](https://aichief.com/alternatives/upcodes/)
- [UpCodes GetApp listing](https://www.getapp.com/it-management-software/a/upcodes/)
- [Codes.IQ vs UpCodes comparison](https://www.inqi.ai/post/codes-iq-vs-up-codes-why-the-future-of-building-code-compliance-is-context-aware-ai)
- [Nomic — supported building codes](https://www.nomic.ai/use-cases/code-compliance-of-drawings/codes)
- [Nomic — automated code compliance use case](https://www.nomic.ai/use-cases/code-compliance-of-drawings)
- [Nomic — platform](https://www.nomic.ai/platform)
- [Nomic — blog on AI in code compliance](https://www.nomic.ai/blog/ai-transforming-building-code-compliance)
- [Dlubal Mia — AI assistant](https://www.dlubal.com/en/support-and-learning/ai-support/mia-your-ai-assistant)
- [Dlubal Mia — blog / award](https://www.dlubal.com/en/news-and-events/news/blog/000146)
- [Dlubal Mia — product feature page](https://www.dlubal.com/en/support-and-learning/support/product-features/002793)
- [CustomGPT — Dlubal case study](https://customgpt.ai/customer/dlubal-ai-24-7-support-engineering-solution/)
- [Civils.ai — homepage](https://civils.ai/)
- [Civils.ai — pricing](https://civils.ai/pricing)
- [Civils.ai — Eurocode blog](https://civils.ai/blog/ai-for-eurocode-regulations)
- [Civils.ai — review on Futurepedia](https://www.futurepedia.io/tool/civils-ai)
- [Civils.ai — Cybernews](https://cybernews.com/ai-knowledge-base/tools/civils-ai/)
- [StructWise (ai-u.com)](https://ai-u.com/en/product/structwise)
- [YesChat — Eurocode Engineer GPT](https://www.yeschat.ai/gpts-9t55QZgjdui-Eurocode-Engineer)
- [Eurocode Information Extractor prompt](https://docsbot.ai/prompts/technical/eurocode-information-extractor)
- [Building Regulations Copilot](https://buildingregulationscopilot.com)
- [CodeComply.ai](https://codecomply.ai/)
- [Datagrid — agents for code extraction](https://datagrid.com/blog/how-ai-agents-automate-building-code-requirement-extraction)
- [VIKTOR.AI — AI agents + MCP for engineers](https://www.viktor.ai/blog/196/how-engineers-can-use-ai-agents-and-mcp-servers-to-work-smarter)
- [Mason & Hanger — AI in code compliance, Part 1](https://www.masonandhanger.com/news/the-current-state-of-affairs-on-using-artificial-intelligence-ai-for-building-code-compliance-part-1)
- [Mason & Hanger — AI in code compliance, Part 2](https://www.masonandhanger.com/news/top-eight-ways-artificial-intelligence-ai-is-transforming-building-code-compliance-part-2)
- [Virginia CS — VLM agent for building code compliance (paper)](https://www.cs.virginia.edu/~bjc8c/papers/zheng25inspection.pdf)
- [DOE / PNNL — AI for energy code compliance 2024](https://www.energy.gov/sites/default/files/2024-11/bto-peer-2024-pnnl-ai-for-energy-code-compliance.pdf)
- [Bluebeam blog — AI legal risks in construction 2025](https://blog.bluebeam.com/ai-legal-risks-construction-compliance-2025/)
- [Eurocodes JRC homepage](https://eurocodes.jrc.ec.europa.eu/)
- [Eurocodes — national standards implementation](https://eurocodes.jrc.ec.europa.eu/en-eurocodes-implementation/national-standards)
- [SCIA Engineer — implemented Eurocode National Annexes](https://www.scia.net/en/scia-engineer/fact-sheets/design-codes/implemented-eurocode-national-annexes)
- [ASRO homepage](https://www.asro.ro/en/)
- [ASRO InfoStandard](https://www.asro.ro/infostandard/)
- [ASRO tariffs page](https://www.asro.ro/tarife/)
- [ASRO magazin](https://magazin.asro.ro/ro/catalog-standarde)
- [ASRO — Romania steps on AI regulation](https://www.asro.ro/ue-si-romania-fac-pasi-importanti-in-reglementarea-inteligentei-artificiale/)
- [ASRO — standardization in support of AI](https://www.asro.ro/standardizarea-in-sprijinul-bunei-functionari-a-tehnologiilor-cu-inteligenta-artificiala/)
- [OAR Bucuresti — ASRO subscription for members](https://www.oar-bucuresti.ro/inscriere-standarde/)
- [OAR — technical regulations page](https://oar.archi/reglementari-tehnice-2/normative-si-standarde/reglementari-tehnice-privind-calculul-constructiilor-si-elementelor-de-constructii/)
- [MDLPA — list of technical regulations in construction](https://www.mdlpa.ro/pages/reglementaritehnice)
- [MDLPA — P100-1/2013 PDF](https://www.mdlpa.ro/userfiles/reglementari/Domeniul_I/I_22_P100_1_2013.pdf)
- [AICPS — P100-1 update 2024](https://www.aicps.ro/media/content/2024-02/p100-1-02022024_65c0c2d57f596.pdf)
- [Revista Constructiilor — P100 commentary](https://www.revistaconstructiilor.eu/index.php/2020/07/01/observatii-si-propuneri-la-normativele-seismice-p100-1-2013-p100-3-2019/)
- [Revista Constructiilor — AI impact on construction 2024](https://www.revistaconstructiilor.eu/index.php/2024/08/07/impactul-inteligentei-artificiale-in-industria-constructiilor/)
- [Revista Constructiilor — CN AIIR 2025](https://www.revistaconstructiilor.eu/index.php/2025/11/06/aiir-conferinta-nationala-a-asociatiei-inginerilor-de-instalatii-din-romania-editia-60-12-14-octombrie-2025-casino-sinaia/)
- [MIGS — RO construction regulations and updates](https://migs.ro/category/legislatie-normative-constructii-instalatii/)
- [StructuralCAD — list of RO construction norms 2016](https://structuralcad.ro/?p=2354)
- [AIIR homepage](https://www.aiiro.ro/)
- [CN AIIR 2024 — 59th edition](https://www.proidea.ro/evenimente-profesionale-2/conferinta-nationala-a-inginerilor-de-instalatii-din-romania-cn-aiir-2024-editia-59-23341.shtml)
- [Agenda Constructiilor — AIIR on engineer shortage](https://www.agendaconstructiilor.ro/files/instalatii-de-apa-sisteme-hvac/aiir-piata-de-instalatii-sufera-de-lipsa-de-ingineri-desi-salariile-sunt-foarte-bune.html)
- [Agenda Constructiilor — MEP Designer launch](https://www.agendaconstructiilor.ro/stiri/digitalizarea-in-constructii-industrie/mep-designer-noua-solutie-bim-pe-piata-din-romania-pentru-proiectarea-instalatiilor)
- [Agenda Constructiilor — CYPE Romania 2026 plans](https://www.agendaconstructiilor.ro/stiri/digitalizarea-in-constructii-industrie/software-bim-constructii-planurile-cype-romania-pentru-2026-si-tranzitia-de-la-cad-la-bim)
- [Uniprest — 2025 construction + installations market report (PDF)](https://www.uniprest.ro/wp-content/uploads/2025/08/raport-constructii-instalatii-in-romania-2025.pdf)
- [Uniprest — report landing page](https://uniprest.ro/raport-piata-de-constructii-instalatii/)
- [Revista Biz — RO construction challenges 2025](https://www.revistabiz.ro/provocarile-industriei-de-constructii-si-instalatii-din-romania-in-2025/)
- [SoftnetConsulting — RO construction digitalization guide 2025](https://softnetconsulting.ro/blog/digitalizare-in-constructii/)
- [PDET — European building materials market 2024](https://www.pdet.ro/blog/piata-materialelor-de-constructii/piata-materialelor-de-constructii-in-europa-2024-statistici-tendinte)
- [Piata Financiara — architecture and construction 2026 / CATUC](https://www.piatafinanciara.ro/arhitectura-si-constructiile-in-2026-sustenabile-inteligente-si-centrate-pe-oameni/)
- [Romania National AI Strategy 2024–2027 (SGG)](https://sgg.gov.ro/1/wp-content/uploads/2024/07/ANEXA-1-10.pdf)
- [Romania National AI Strategy (ADR)](https://www.adr.gov.ro/wp-content/uploads/2024/03/Strategie-Inteligenta-Artificiala-22012024-1.pdf)
- [Romania AI Strategic Framework (MCID)](https://www.mcid.gov.ro/wp-content/uploads/2023/08/CSN-IA_28Iulie.pdf)
- [Juridice.ro — RO National AI Strategy 2024–2027](https://www.juridice.ro/743158/strategia-nationala-in-domeniul-inteligentei-artificiale-2024-2027.html)
- [ADR homepage](https://www.adr.gov.ro/en)
- [Curs de Guvernare — Romanian-language AI tools](https://cursdeguvernare.ro/inteligenta-artificiala-in-limba-romana-3-instrumente-utile.html)
- [ProTV — Fonduri-structurale.ro AI assistant](https://stirileprotv.ro/stiri/i-like-ai/fonduri-structurale-ro-lanseaza-prima-platforma-din-romania-cu-asistent-ai-specializat-in-identificarea-surselor-de-finantare.html)
- [ChatbotJuridic.ro — legal AI](https://chatbotjuridic.ro/descopera-puterea-ai-in-analiza-documentelor-asistentjuridic-ro-schimba-regulile-jocului/)
- [PoliHack — organizing body](https://www.polihacks.dev/)
- [PoliHack — OSUT](https://polihack.osut.org/)

Idea 3: The "MEP Compliance RAG" (Domain-Specific AI Tool)
Target Jump: L0 (No AI) → L1 (Opportunistic) or L2 (Systematized)
Target Audience: Non-Software Engineers (MEP, Civil, Architecture)

The brief explicitly encourages looking beyond software to fields like MEP (Mechanical, Electrical, and Plumbing) and notes that an engineer searching EU standards is a great use case.

The Problem: Civil and MEP engineers spend hours manually cross-referencing their building plans with massive PDF databases of EU or local building codes.

The Technical Execution: Build a specialized Retrieval-Augmented Generation (RAG) system.

Backend: A vector database (like Pinecone or local Chroma) loaded with parsed, chunked building codes (e.g., fire safety regulations, ventilation standards).

Frontend/Integration: An application where an engineer can upload a structured export of their CAD/BIM model (like a JSON of room dimensions and HVAC capacities).

The AI: The system automatically queries the uploaded parameters against the vector database to flag potential compliance violations.

Why it wins: It perfectly captures the "lighthouse case" warning: generic ChatGPT doesn't help an MEP engineer because it lacks domain context. By building a domain-specific RAG tool, you create immediate, measurable value for a non-software engineering field.

1. Solving the "Use-Case Problem" (Getting them from L0 to L1)
The brief notes that AI is a general-purpose technology, and people struggle to extrapolate generic use cases to their own highly specific work. An MEP engineer sitting at L0 (No observable AI use) won't use ChatGPT because it hallucinates building codes.

The Adoption Hook: By building a highly constrained, domain-specific RAG that cites the exact page and paragraph of the EU directive, you eliminate the trust barrier. You aren't just giving them AI; you are giving them a safe, verifiable environment to learn how to delegate research tasks to a machine.

2. Forcing the Shift to L2 (Systematized Prompting)
This is where the hackathon points are won. L2 adoption happens when instructions and prompts are shared and reused.

The Adoption Feature: Don't just make it a chat box. Build a feature called "Compliance Routines." When a senior engineer figures out the perfect sequence of questions to ask the AI to check a specific fire safety code, they can hit "Save as Routine" and publish it to their firm's workspace. Now, Junior engineers can run that exact same AI workflow with one click. You have tangibly moved the team to L2 by systematizing their interactions with the AI.

3. Measuring the Behavioral Change
The brief states: "Without measurement, AI adoption remains a one-time experiment".

The Adoption Feature: Build a dashboard for the engineering manager that tracks how the team's workflow is changing. Track metrics like "Frequency of AI-assisted workflows" or "Time saved vs. manual PDF lookups". This proves to the judges that you aren't just hoping for adoption; you are actively monitoring the transition from manual work to AI-assisted work.

The Pitch to the Judges:
"We didn't just build an AI tool for civil engineers. We built an adoption platform. We take engineers who have never trusted AI (L0), give them a verifiable system they can trust to reach L1, and then provide a 'Routines' sharing system to immediately pull the whole firm up to L2." Does that bridge the gap between building cool tech and actually fulfilling the hackathon's core theme?
# DESIGN.md

**Thesis:** *Code handles time, memory and freshness, not the LLM. The LLM only does what code cannot: understanding and writing.*

---

## 1. How It Works

Every challenge prompt follows a tripartite pattern: **recall** past conversation context → **search** the live web for updates since that moment → **compare** the claims to produce a reliable diff.

```
User Message (+ browser tz & now)
  │
  ├─▶ [1] Temporal Resolver     (deterministic code, ~1ms)  "last Tuesday" → candidate windows
  │                                                          "this week" → Mon–Sun range
  │
  ├─▶ [2] Memory Retrieval      (SQLite + FTS5, ~5ms)       two-tier AND→OR with keyword post-filter
  │
  ├─▶ [3] Router                (fast LLM, ~300ms)          JSON plan: mode, parallel queries, since date
  │
  ├─▶ [4] Parallel Search       (Tavily API, Promise.all)   parallel search with date filters
  │
  ├─▶ [5] Synthesis             (strong LLM, streamed)      streamed answer + numbered citations + diff
  │
  └─▶ [6] Claims Ledger         (async LLM, non-blocking)   extracts {entity, attr, value, asOf}
```

1. **Temporal Resolver (`temporal.ts`)**: Deterministic date parser via `chrono-node`. Handles ambiguous relative phrases like *"last Tuesday"* by generating both this week's and last week's candidate windows. Phrases like *"this week"* and *"last week"* expand to full Monday–Sunday spans (not single-day snapshots) to ensure cross-session recall of conversations that happened on any day within the week.
2. **Memory Retrieval (`memory.ts`)**: Queries local SQLite using FTS5 full-text indexing joined with temporal range filters. Uses a two-tier search strategy: strict `AND` match first for precision, then BM25-ranked `OR` fallback (gated to 3+ keywords) with post-filtering requiring ≥40% keyword hits per result to prevent false positives. Parenthetical meta-instructions in user messages are stripped before keyword extraction. Disambiguates candidate dates by checking where prior conversations actually occurred.
3. **Router (`router.ts`)**: A low-latency model produces a strictly typed JSON search plan (`direct`, `search`, `recall`, `recheck`, or `clarify`). Token limits are clamped per step to operate within rate-limited free tiers (e.g., Groq's 1,000 OTPM).
4. **Parallel Search (`search.ts`)**: Code derives explicit date parameters (`since`) for Tavily, firing up to 5 targeted queries concurrently with an in-memory 5-minute TTL cache. Search snippets are truncated to 450 characters to stay within tight token budgets.
5. **Synthesis (`synth.ts`)**: A reasoning model streams markdown answers token-by-token over Server-Sent Events (SSE), backing every claim with `[n]` citations. An explicit anti-tool directive prevents models fine-tuned for tool execution from hallucinating tool-call JSON in the output.
6. **Claims Ledger (`claims.ts`)**: Fires asynchronously after synthesis. Normalizes answers into structured factual claims (`entity`, `attribute`, `value`, `asOf`). Subsequent rechecks diff structured data rather than unstructured prose.

---

## 2. Key Design Decisions

- **Memory is a deterministic pipeline step, not an agent tool:** The challenge permits exactly one tool: web search. Treating conversation memory as deterministic code ensures 100% recall reliability without wasting LLM turns or risking hallucinated memory calls.
- **Router / Synthesis model split:** Query classification and query generation require speed, not heavy prose generation. We route with a fast, cost-efficient model (~300ms) and reserve the larger model for synthesis.
- **SQLite + FTS5 instead of vector databases:** Conversational recall in this domain is temporal and lexical ("3 November", "Postgres hosting"). SQLite with FTS5 and WAL mode runs in sub-10ms with zero cloud dependencies or API keys.
- **Two-tier retrieval (AND → OR with post-filter):** A strict `AND` query on all keywords catches exact multi-topic matches. When that misses (common with conversational filler), a BM25-ranked `OR` fallback runs — but only when there are 3+ keywords, and each result must contain at least 40% of the query keywords. This prevents a single-token false positive (e.g., "email" in a CRM message matching an "email marketing" query) while still handling noisy natural-language phrasing.
- **Parenthetical stripping:** User messages often include meta-instructions in parentheses (e.g., challenge prompt annotations). These are stripped before keyword extraction to keep the search focused on the actual topic.
- **Claims Ledger for factual diffs:** Prompting an LLM to compare two long prose texts often yields false "no change" conclusions. Diffing structured claim records (`{ entity, attr, value, asOf }`) grounds the comparison in verifiable units.
- **Server-Sent Events (SSE):** SSE provides unidirectional HTTP streaming with zero handshake overhead compared to WebSockets, maintaining compatibility with standard HTTP caches and proxies.
- **Provider-agnostic via `OPENAI_BASE_URL`:** The pipeline uses the standard OpenAI SDK and accepts any OpenAI-compatible endpoint (Groq, Google Gemini, OpenRouter). This allows running the entire agent on free-tier providers with zero code changes — only `.env` configuration.
- **Rate-limit-aware token clamping:** Each pipeline step enforces strict `max_tokens` limits (router: 250, claims: 300, synthesis: 600) to stay within the output-token-per-minute caps of free-tier providers like Groq (1,000 OTPM).

---

## 3. What Was Considered and Rejected

- **LangChain / Agent Frameworks:** Rejected. Framework abstractions add opaque debugging layers, bloated dependency trees, and arbitrary agent loops that degrade latency. A custom 200-line pipeline makes every decision explicit and auditable.
- **Vector Embeddings for Memory:** Rejected for the primary path. Embedding distance models struggle with exact relative dates ("Monday vs last Monday"). FTS5 + temporal SQL intervals are deterministic and exact.
- **Unbounded ReAct Loops:** Rejected. Open-ended "think-act-observe" loops frequently spiral into repetitive searches, blowing past latency budgets. We cap search to parallel rounds with strict limits.
- **Full-Page HTML Scraping:** Rejected. Extracting raw HTML introduces DOM fragility, cookie banners, and latency. Tavily returns clean markdown excerpts extracted specifically for agent consumption.
- **Loose OR-only keyword search:** Rejected. Early iterations used a BM25 `OR` query for all keyword counts, which caused false positives (e.g., a CRM discussion containing "email tracking" matched a query about "email marketing tools"). The two-tier AND→OR strategy with post-filtering was introduced to balance recall and precision.

---

## 4. Known Weaknesses

- **FTS5 Lexical Sensitivity:** If a user asked about *"Postgres"* and later asks *"did our relational database pricing change?"*, lexical search without exact synonym overlap may miss the hit unless caught by the router.
- **Extraction Granularity:** Complex multi-dimensional pricing matrices (e.g. storage vs egress vs compute tiers) can be challenging to compress into simple `{entity, attr, value}` tuples.
- **Single-Host SQLite:** Currently designed for single-node deployments. While perfect for local development and edge nodes, multi-region distributed deployments would require Turso or LiteFS.
- **Free-Tier Rate Limits:** When using providers like Groq's free tier, the 1,000 OTPM ceiling constrains response length. Synthesis is capped at 600 tokens, which is adequate for most answers but can truncate very detailed multi-entity comparisons.

---

## 5. What I'd Do With Another Week

1. **Hybrid Retrieval (Dense + Lexical):** Integrate `sqlite-vec` to run hybrid reciprocal rank fusion (RRF), combining FTS5 keyword matching with local embedding vectors for semantic synonym matching. This would solve the "Postgres" ↔ "relational database" gap.
2. **Automated Background Verification (Cron Workers):** Allow the agent to periodically re-evaluate saved claims ledger records in the background and notify the user when a vendor silently changes pricing.
3. **Multi-Source Cross-Verification:** When search sources conflict, perform a secondary targeted search on the official vendor domain (`site:vendor.com/pricing`) to resolve discrepancies.
4. **Adaptive Token Budgeting:** Dynamically adjust `max_tokens` based on the provider's actual rate-limit headers (`x-ratelimit-remaining-tokens`) rather than static caps, enabling fuller responses when capacity is available.
5. **Conversation Threading UI:** Add a sidebar showing past sessions with search, so users can browse and resume prior threads directly.

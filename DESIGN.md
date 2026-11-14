# DESIGN.md

**Thesis:** *Code handles time, memory and freshness, not the LLM. The LLM only does what code cannot: understanding and writing.*

---

## 1. How It Works

Every turn follows a tripartite pattern: recall context, search for updates, and compare claims to produce a diff.

```
User Message (+ browser tz & now)
  ├─▶ [1] Temporal Resolver  (chrono-node, approx. 1ms)   "last Tuesday" → candidate dates
  ├─▶ [2] Memory Retrieval   (SQLite + FTS5, approx. 5ms) Date range + keyword intersection
  ├─▶ [3] Router             (Fast LLM, approx. 300ms)    JSON plan: mode, queries, since date
  ├─▶ [4] Parallel Search    (Tavily API)                 Concurrent queries with date filters
  ├─▶ [5] Synthesis          (Reasoning LLM)              Streamed answer with citations & diff
  └─▶ [6] Claims Ledger      (Async LLM)                  Extracts {entity, attr, value, asOf}
```

Deterministic code resolves dates and searches SQLite before model calls. The router schedules parallel queries when needed, streaming synthesis over SSE. An asynchronous task logs verifiable claims.

---

## 2. Key Decisions

- **Memory as a pipeline step, not a tool:** Avoids agent loops for deterministic, auditable recall; if memory is empty, the router searches entities or asks clarification without inventing past turns.
- **Router / synthesis model split:** Fast models handle JSON planning (approx. 300ms), reserving the reasoning model for streaming synthesis.
- **SQLite + FTS5 over vector databases:** Recall is temporal and lexical; SQLite runs in sub-10ms with zero external dependencies.
- **Two-tier AND→OR retrieval with post-filter:** Strict AND catches exact topics; BM25 OR fallback (3+ keywords, 40% hit density) prevents conversational filler from dropping recall.
- **Claims ledger for structured diffs:** Diffing structured {entity, attr, value, asOf} records avoids hallucinations over prose.
- **Provider-agnostic via OPENAI_BASE_URL:** Standard OpenAI SDK usage enables OpenAI, Groq, Gemini, or local models.

---

## 3. Considered and Rejected

- **LangChain / Agent Frameworks:** Framework abstractions add latency and loops; a small custom pipeline makes decisions explicit and auditable.
- **Vector Embeddings for Memory:** Distance models struggle with relative dates; SQL intervals with FTS5 give exact temporal precision.
- **Unbounded ReAct Loops:** Multi-step loops cycle into repetitive queries; single-round parallel search bounds latency.
- **Full-Page Scraping:** Raw DOM trees add fragility and latency; search API excerpts return clean summaries.
- **Loose OR-only Search:** BM25 OR caused false positives (CRM notes matching email queries); two-tier filtering with hit-density gating fixed this.

---

## 4. Known Weaknesses

- **FTS5 Lexical Sensitivity:** Lexical indexing misses synonyms ("Postgres" vs "relational database") unless caught by the router.
- **Complex Pricing Matrices:** Multi-dimensional pricing tiers (compute, storage, egress) are hard to compress into scalar tuples.
- **Single-Node SQLite:** Embedded SQLite requires local disk, precluding multi-region deployments without replication.
- **Token Caps for Free Tiers:** Clamping synthesis to 600 tokens avoids rate limits on free tiers; this is a quota tradeoff, not a quality choice.

---

## 5. With Another Week

- **Hybrid Retrieval (Dense + Lexical):** Combine SQLite FTS5 with sqlite-vec embeddings via reciprocal rank fusion to bridge synonym gaps.
- **Background Verification Workers:** Run cron jobs over claims entries to detect upstream pricing changes automatically.
- **Domain Cross-Verification:** Scrape vendor documentation directly when search snippets conflict.
- **Dynamic Token Budgeting:** Read rate-limit headers to adjust generation caps adaptively rather than using static ceilings.
- **Multi-Session Sidebar:** Provide an indexed UI panel for browsing and resuming past conversation threads.

# 🌙 Lunax

> **A chat agent that remembers what it told you, and checks whether it's still true.**  
> Built for the Minimi hiring challenge · November 2026.

---

## The Thesis

> *Code handles time, memory and freshness, not the LLM. The LLM only does what code cannot: understanding and writing.*

Lunax is built around a temporal research loop designed specifically for questions like:
- *"On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"*
- *"What did I ask you on 3 November? Is your answer still correct today?"*
- *"Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"*
- *"Which Redis providers did we just talk about? Did any of them have a pricing update this week?"*

Rather than relying on an unpredictable LLM ReAct loop or heavy agent frameworks, Lunax uses a deterministic 6-step pipeline with persistent SQLite memory, temporal resolution, parallel web search, and a structured claims ledger.

---

## Architecture

```
User Message (+ browser tz & now)
  │
  ├─▶ [1] Temporal Resolver     (chrono-node, approx. 1ms)   Resolves "last Tuesday", "this week" to candidate date windows
  │
  ├─▶ [2] Memory Retrieval      (SQLite + FTS5, approx. 5ms) Two-tier search (AND → OR) with date range intersection
  │
  ├─▶ [3] Router                (Fast LLM, approx. 300ms)    Produces typed JSON plan (mode, queries, since date)
  │
  ├─▶ [4] Parallel Search       (Tavily API)                 Concurrent queries with date filters & 5m TTL cache
  │
  ├─▶ [5] Synthesis             (Reasoning LLM)              Streams answer with [n] citations and diff cards via SSE
  │
  └─▶ [6] Claims Ledger         (Async LLM)                  Extracts {entity, attr, value, asOf} for future diffing
```

For full architectural trade-offs and rationale, see [DESIGN.md](./DESIGN.md).

---

## Quick Start

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v20/v22)
- An OpenAI-compatible API key (OpenAI, Groq, Google Gemini, OpenRouter, etc.)
- Tavily API key ([tavily.com](https://tavily.com))

### 2. Installation
```bash
git clone https://github.com/adityars07/Lunax.git
cd Lunax
npm install
```

### 3. Environment Setup
Copy `.env.example` to `.env` and insert your API keys:
```bash
cp .env.example .env
```

Edit `.env`:
```ini
# Required
OPENAI_API_KEY=your-api-key-here
TAVILY_API_KEY=tvly-...

# Optional: use any OpenAI-compatible provider (Groq, Gemini, OpenRouter)
# OPENAI_BASE_URL=https://api.groq.com/openai/v1

# Model selection (defaults work with OpenAI; override for other providers)
ROUTER_MODEL=gpt-4o-mini
SYNTH_MODEL=gpt-4o
CLAIMS_MODEL=gpt-4o-mini

# Optional: server & db
PORT=3000
DB_PATH=./lunax.db
```

#### Free-Tier Example (Groq)

Lunax works with Groq's free tier — no credit card required:

```ini
OPENAI_API_KEY=gsk_...
OPENAI_BASE_URL=https://api.groq.com/openai/v1
ROUTER_MODEL=qwen/qwen3.8-27b
SYNTH_MODEL=qwen/qwen3.8-27b
CLAIMS_MODEL=qwen/qwen3.8-27b
SYNTH_MAX_TOKENS=600
TAVILY_API_KEY=tvly-...
```

> **Note:** Groq's free tier enforces a 1,000 output-tokens-per-minute (OTPM) limit. Setting `SYNTH_MAX_TOKENS=600` ensures streamed responses stay within these limits.

### 4. Run the Agent
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## Running the Evaluation Suite

Lunax includes 12 automated test cases covering temporal resolution, memory retrieval, router mode classification, edge cases, security, and the benchmark challenge prompts:

```bash
npm run eval
```

This command automatically seeds the SQLite database with benchmark conversations for **3 November**, **Monday 9 Nov**, and **Tuesday 10 Nov**, then runs the full assertion suite.

### Eval Breakdown

| Category | Tests | Network Required |
|:---|:---|:---|
| Temporal resolution (candidate generation, timezone edge cases) | 2 | No |
| Memory retrieval (empty-memory graceful fallback) | 1 | No |
| Static behavior & assertions (security prompt injection, timestamp mandate) | 2 | No |
| Live router classification (direct, search, recall, recheck modes) | 7 | Yes |

The 5 deterministic tests run completely offline; the 7 router tests require a live LLM API connection to evaluate mode classification and query generation. In `evals/run.ts`, tests with `expectedCandidateCount` or `expectMemoryHit` verify date parsing (`chrono-node`) and SQLite FTS5 retrieval directly against the database without external calls. Tests with `expectedMode` evaluate live model behavior by querying the configured router model (`ROUTER_MODEL`) and asserting on the returned plan JSON and query counts.

---

## Known Limitations

- **Free-Tier Token Caps:** Free-tier providers like Groq enforce tight output rate limits (e.g. 1,000 OTPM), requiring lower `SYNTH_MAX_TOKENS` (600) which can truncate long multi-entity comparison responses.
- **Lexical-Only Memory Retrieval:** FTS5 full-text indexing matches keyword tokens and does not capture semantic synonyms (e.g. "Postgres" vs "relational database") unless bridge terms are caught by the router.
- **Single-Node SQLite:** Memory is stored in a local SQLite file, suitable for single-node setups but requiring replication layers for multi-region deployments.

---

## Testing the Benchmark Prompts

When running `npm run dev`, you can click any of the preset chips in the chat UI or paste them directly:

1. **CRM Shortlist Recheck:**
   > *"On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"*
2. **Exact Date Recall & Freshness:**
   > *"What did I ask you on 3 November? Is your answer still correct today?"*
3. **Temporal Ambiguity Disambiguation:**
   > *"Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"*

An end-to-end trace of these interactions is documented in [examples/transcript.md](./examples/transcript.md).

---

## Project Structure

```
lunax/
├── src/
│   ├── server.ts        # Express server, SSE streaming, session APIs
│   ├── pipeline.ts      # 6-step deterministic turn orchestrator
│   ├── temporal.ts      # chrono-node date parsing, multi-candidate builder,
│   │                    # full Monday–Sunday week ranges for "this/last week"
│   ├── memory.ts        # SQLite storage, FTS5 full-text indexing,
│   │                    # two-tier AND→OR retrieval with keyword post-filter
│   ├── router.ts        # Fast LLM planner returning typed JSON
│   ├── search.ts        # Tavily parallel search with date filters & TTL cache
│   ├── synth.ts         # Streaming synthesis with citations & source cards
│   ├── claims.ts        # Asynchronous claims ledger extractor & diff engine
│   ├── prompts.ts       # Strictly typed system & user prompts
│   ├── config.ts        # Environment configuration (supports OPENAI_BASE_URL)
│   └── types.ts         # TypeScript definitions
├── public/
│   └── index.html       # Zero-build UI with live pipeline step telemetry & diff cards
├── evals/
│   ├── cases.json       # 12 benchmark test cases & edge cases
│   ├── seed.ts          # Synthetic conversation seeder for benchmark dates
│   └── run.ts           # Automated test runner
├── examples/
│   └── transcript.md    # Turn-by-turn trace of the challenge prompts
├── DESIGN.md            # Design doc: how it works, trade-offs, rejected options
├── package.json
└── tsconfig.json
```

---

## Key Differentiators

| Feature | How Lunax does it |
| :--- | :--- |
| **Relative Dates** | `chrono-node` resolves phrases like "last Tuesday" into candidate date windows disambiguated against SQLite memory |
| **Week Ranges** | Expands "this week" and "last week" into full Monday–Sunday 7-day ranges rather than single-day snapshots |
| **Cross-Session Recall** | Two-tier lexical retrieval (strict AND falling back to BM25-ranked OR with post-filtering) across all past sessions |
| **"Is it still correct?"** | Diffs structured claims `{entity, attr, value, asOf}` against fresh search results rather than comparing raw prose |
| **Transparency** | Real-time Server-Sent Events (SSE) telemetry displays each pipeline stage and diff card live in the UI |

---

## License

MIT

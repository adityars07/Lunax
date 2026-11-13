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
  ├─▶ [1] Temporal Resolver     (chrono-node, ~1ms)      Resolves "last Tuesday", "this week" to candidate date windows
  │
  ├─▶ [2] Memory Retrieval      (SQLite + FTS5, ~5ms)    Two-tier search (AND → OR) with date range intersection
  │
  ├─▶ [3] Router                (Fast LLM, ~300ms)       Produces typed JSON plan (mode, queries, since date)
  │
  ├─▶ [4] Parallel Search       (Tavily API)             Concurrent queries with date filters & 5m TTL cache
  │
  ├─▶ [5] Synthesis             (Reasoning LLM)          Streams answer with [n] citations and diff cards via SSE
  │
  └─▶ [6] Claims Ledger         (Async LLM)              Extracts {entity, attr, value, asOf} for future diffing
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
TAVILY_API_KEY=tvly-...
```

> **Note:** Groq's free tier enforces a 1,000 output-tokens-per-minute (OTPM) limit. Lunax automatically clamps `max_tokens` for each pipeline step (router: 250, claims: 300, synthesis: 600) to stay within these limits.

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
| Memory retrieval (graceful fallback, empty memory) | 1 | No |
| Security (prompt injection defense) | 1 | No |
| Synthesis format (asOf timestamp mandate) | 1 | No |
| Search mode (fresh pricing inquiry) | 1 | Yes |
| Router classification (direct, recall, recheck modes) | 6 | Yes |

The 6 deterministic tests pass offline; the 6 router-dependent tests require a live LLM API connection.

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
├── DESIGN.md            # One-page design doc & architectural defense
├── package.json
└── tsconfig.json
```

---

## Key Differentiators

| Feature | Typical Chatbot | Lunax |
| :--- | :--- | :--- |
| **Tool Execution** | Open-ended ReAct loop (slow, prone to loops) | Deterministic 6-step pipeline (predictable latency) |
| **Memory Architecture** | In-context window or heavy vector database | Local SQLite + FTS5 with temporal window filters |
| **Relative Dates** | LLM guesses what "last Tuesday" means | `chrono-node` generates candidate windows, verified against memory |
| **Week Ranges** | N/A or LLM hallucinated | Full Monday–Sunday spans for "this week" / "last week" |
| **Cross-Session Recall** | Limited to current session | Searches all past sessions via FTS5 + date range intersection |
| **"Is it still correct?"** | LLM compares messy prose text | Grounded diff engine on structured claims `{entity, attr, value}` |
| **Latency** | Single monolithic LLM call for all tasks | Split architecture: fast model routes, strong model streams |
| **Provider Flexibility** | Locked to one API vendor | Any OpenAI-compatible provider via `OPENAI_BASE_URL` |
| **Transparency** | Black box waiting spinner | Real-time SSE telemetry displaying pipeline stages live in the UI |

---

## License

MIT

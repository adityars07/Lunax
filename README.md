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

Rather than relying on an unpredictable LLM ReAct loop or heavy agent frameworks, Lunax uses a deterministic 6-step pipeline with persistent SQLite memory, temporal resolution, parallel web search, and a structured claims ledger.

---

## Architecture

```
User Message (+ browser tz & now)
  │
  ├─▶ [1] Temporal Resolver     (chrono-node, ~1ms)      Resolves "last Tuesday" to candidate date windows
  │
  ├─▶ [2] Memory Retrieval      (SQLite + FTS5, ~5ms)    Intersects date window with keyword search
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
- OpenAI API key
- Tavily API key ([tavily.com](https://tavily.com))

### 2. Installation
```bash
git clone https://github.com/your-username/lunax.git
cd lunax
npm install
```

### 3. Environment Setup
Copy `.env.example` to `.env` and insert your API keys:
```bash
cp .env.example .env
```

Edit `.env`:
```ini
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...

# Optional configurations:
ROUTER_MODEL=gpt-4o-mini
SYNTH_MODEL=gpt-4o
CLAIMS_MODEL=gpt-4o-mini
PORT=3000
DB_PATH=./lunax.db
```

### 4. Run the Agent
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## Running the Evaluation Suite

Lunax includes an automated test harness covering deterministic temporal resolution, memory retrieval, router mode classification, edge cases, and the benchmark challenge prompts:

```bash
npm run eval
```

This command automatically seeds the SQLite database with benchmark conversations for **3 November**, **Monday 9 Nov**, and **Tuesday 10 Nov**, then runs the assertion suite.

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
│   ├── temporal.ts      # chrono-node date parsing & multi-candidate builder
│   ├── memory.ts        # SQLite storage, FTS5 full-text indexing, retrieval
│   ├── router.ts        # Fast LLM planner returning typed JSON
│   ├── search.ts        # Tavily parallel search with date filters & TTL cache
│   ├── synth.ts         # Streaming synthesis with citations & source cards
│   ├── claims.ts        # Asynchronous claims ledger extractor & diff engine
│   ├── prompts.ts       # Strictly typed system & user prompts
│   ├── config.ts        # Environment configuration
│   └── types.ts         # TypeScript definitions
├── public/
│   └── index.html       # Zero-build UI with live pipeline step telemetry & diff cards
├── evals/
│   ├── cases.json       # Benchmark test suite & edge cases
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
| **"Is it still correct?"** | LLM compares messy prose text | Grounded diff engine on structured claims `{entity, attr, value}` |
| **Latency** | Single monolithic LLM call for all tasks | Split architecture: fast model routes, strong model streams |
| **Transparency** | Black box waiting spinner | Real-time SSE telemetry displaying pipeline stages live in the UI |

---

## License

MIT


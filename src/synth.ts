import OpenAI from 'openai';
import type { SSEWriter, MemoryResult, SearchResult, RouterPlan, SourceItem } from './types.js';
import { config } from './config.js';
import { SYNTH_SYSTEM_PROMPT, buildSynthUserPrompt } from './prompts.js';
import { formatMemoryForPrompt, formatClaimsForPrompt } from './memory.js';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
});

/**
 * Stream the final synthesis answer to the user.
 * Returns the full response text (for persistence and claims extraction).
 */
export async function synthesize(
  message: string,
  plan: RouterPlan,
  memory: MemoryResult,
  searchResults: SearchResult[],
  sessionHistory: { role: string; content: string }[],
  writer: SSEWriter,
  now: string,
  tz: string,
): Promise<string> {
  const memoryCtx  = formatMemoryForPrompt(memory);
  const claimsCtx  = formatClaimsForPrompt(memory.claims);
  const searchCtx  = formatSearchContext(searchResults);

  // Build messages array
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYNTH_SYSTEM_PROMPT },
  ];

  // Include recent session history for follow-up context (last 10 turns)
  const recentHistory = sessionHistory.slice(-10);
  for (const turn of recentHistory) {
    messages.push({
      role: turn.role as 'user' | 'assistant',
      content: turn.content,
    });
  }

  // The assembled user prompt with all context
  messages.push({
    role: 'user',
    content: buildSynthUserPrompt(message, memoryCtx, searchCtx, claimsCtx, plan.mode, now, tz),
  });

  // Stream the response
  const stream = await openai.chat.completions.create({
    model: config.synthModel,
    messages,
    stream: true,
    temperature: 0.3,
    max_tokens: 600,
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (delta) {
      full += delta;
      writer.text(delta);
    }
  }

  // Emit source references
  const sources = collectSources(searchResults);
  if (sources.length > 0) {
    writer.sources(sources);
  }

  return full;
}

// ── Helpers ─────────────────────────────────────────────────

/** Format search results into a numbered reference block for the LLM. */
function formatSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return '';

  let n = 1;
  const sections: string[] = [];

  for (const sr of results) {
    if (sr.error) {
      sections.push(`Search "${sr.query}": ERROR — ${sr.error}`);
      continue;
    }
    if (sr.results.length === 0) {
      sections.push(`Search "${sr.query}": no results`);
      continue;
    }

    const items = sr.results.slice(0, 2).map((item) => {
      const num = n++;
      const date = item.publishedDate ? ` (${item.publishedDate})` : '';
      const snippet = item.content.slice(0, 450).trim();
      return `[${num}] ${item.title}${date}\n    URL: ${item.url}\n    Summary: ${snippet}`;
    }).join('\n\n');

    sections.push(`### Search: "${sr.query}"\n${items}`);
    if (n > 8) break; // Keep prompt concise and under token limits
  }

  return sections.join('\n\n');
}

/** Collect all source URLs across all search results for the sources SSE event. */
function collectSources(results: SearchResult[]): SourceItem[] {
  const sources: SourceItem[] = [];
  let n = 1;
  for (const sr of results) {
    for (const item of sr.results) {
      sources.push({ n: n++, title: item.title, url: item.url });
    }
  }
  return sources;
}


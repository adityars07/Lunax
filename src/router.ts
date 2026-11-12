import OpenAI from 'openai';
import type { RouterPlan, MemoryResult, DateReference } from './types.js';
import { config } from './config.js';
import { ROUTER_SYSTEM_PROMPT, buildRouterUserPrompt } from './prompts.js';
import { formatDateContext } from './temporal.js';
import { formatMemoryForPrompt } from './memory.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

/**
 * Classify the user's query and generate a search plan.
 * Uses the fast/small model for low latency.
 */
export async function plan(
  message: string,
  memory: MemoryResult,
  dateRefs: DateReference[],
  now: string,
  tz: string,
): Promise<RouterPlan> {
  const memoryContext = formatMemoryForPrompt(memory);
  const dateContext = formatDateContext(dateRefs);

  try {
    const res = await openai.chat.completions.create({
      model: config.routerModel,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRouterUserPrompt(message, memoryContext, memory.status, dateContext, now, tz),
        },
      ],
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) return fallback(message);

    const parsed = JSON.parse(raw);
    return sanitize(parsed, message);
  } catch (err) {
    console.error('Router error, falling back to search:', err);
    return fallback(message);
  }
}

/** Validate and clamp the LLM output into a safe RouterPlan. */
function sanitize(raw: Record<string, unknown>, message: string): RouterPlan {
  const validModes = ['direct', 'search', 'recheck', 'recall', 'clarify'] as const;
  const mode = validModes.includes(raw.mode as typeof validModes[number])
    ? (raw.mode as RouterPlan['mode'])
    : 'search';

  const queries = Array.isArray(raw.queries)
    ? (raw.queries as string[]).filter((q) => typeof q === 'string').slice(0, 5)
    : [message];

  return {
    mode,
    queries: queries.length > 0 ? queries : [message],
    since: typeof raw.since === 'string' ? raw.since : null,
    entities: Array.isArray(raw.entities)
      ? (raw.entities as string[]).filter((e) => typeof e === 'string')
      : [],
    clarifyQuestion: typeof raw.clarifyQuestion === 'string' ? raw.clarifyQuestion : null,
  };
}

function fallback(message: string): RouterPlan {
  return { mode: 'search', queries: [message], since: null, entities: [], clarifyQuestion: null };
}


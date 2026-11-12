import OpenAI from 'openai';
import type { ExtractedClaim, DiffItem, StoredClaim, SearchResult } from './types.js';
import { config } from './config.js';
import { CLAIMS_SYSTEM_PROMPT } from './prompts.js';
import { saveClaims } from './memory.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// ── Async extraction (runs after response has streamed) ─────

/**
 * Extract structured claims from the assistant's response and persist them.
 * Runs asynchronously — never blocks the user.
 */
export async function extractAndSave(
  sessionId: string,
  msgId: string,
  assistantContent: string,
): Promise<void> {
  try {
    const res = await openai.chat.completions.create({
      model: config.claimsModel,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: CLAIMS_SYSTEM_PROMPT },
        { role: 'user', content: assistantContent },
      ],
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) return;

    const parsed = JSON.parse(raw) as { claims?: ExtractedClaim[] };
    const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
    if (claims.length === 0) return;

    saveClaims(
      sessionId,
      msgId,
      claims
        .filter((c) => c.entity && c.attr && c.value)
        .map((c) => ({
          entity: String(c.entity),
          attr: String(c.attr),
          value: String(c.value),
          sourceUrl: c.sourceUrl ? String(c.sourceUrl) : null,
        })),
    );

    console.log(`  ✓ Extracted ${claims.length} claims for msg ${msgId.slice(0, 8)}`);
  } catch (err) {
    console.error('Claims extraction failed (non-critical):', err);
  }
}

// ── Deterministic diff ──────────────────────────────────────

/**
 * Build a preliminary diff between old claims and fresh search results.
 * This is a best-effort heuristic: the synthesis LLM does the real comparison.
 * The diff is sent to the UI as structured data for a visual "changes" card.
 */
export function buildDiff(
  oldClaims: StoredClaim[],
  searchResults: SearchResult[],
): DiffItem[] {
  if (oldClaims.length === 0) return [];

  // Combine all search content into one searchable string
  const corpus = searchResults
    .flatMap((sr) => sr.results.map((r) => `${r.title} ${r.content}`))
    .join('\n')
    .toLowerCase();

  return oldClaims.map((claim): DiffItem => {
    const entityLower = claim.entity.toLowerCase();
    const valueLower  = claim.value.toLowerCase();

    const entityFound = corpus.includes(entityLower);
    if (!entityFound) {
      return {
        entity: claim.entity,
        attr: claim.attr,
        status: 'unknown',
        old: claim.value,
        now: null,
        note: 'Not mentioned in current search results',
      };
    }

    const valueFound = corpus.includes(valueLower);
    if (valueFound) {
      return {
        entity: claim.entity,
        attr: claim.attr,
        status: 'same',
        old: claim.value,
        now: claim.value,
        note: null,
      };
    }

    // Entity found but exact value not confirmed → might have changed
    return {
      entity: claim.entity,
      attr: claim.attr,
      status: 'unknown',
      old: claim.value,
      now: null,
      note: 'Value not confirmed in current results — may have changed',
    };
  });
}


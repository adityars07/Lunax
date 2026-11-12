import type { SearchResult, SearchItem } from './types.js';
import { config } from './config.js';

// ── Simple TTL cache ────────────────────────────────────────

const cache = new Map<string, { result: SearchResult; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Public API ──────────────────────────────────────────────

/** Run up to 5 search queries in parallel and return all results. */
export async function parallelSearch(
  queries: string[],
  since?: string | null,
): Promise<SearchResult[]> {
  const capped = queries.slice(0, 5);
  return Promise.all(capped.map((q) => search(q, since)));
}

// ── Internals ───────────────────────────────────────────────

async function search(query: string, since?: string | null): Promise<SearchResult> {
  const cacheKey = `${query}|${since ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  try {
    const body: Record<string, unknown> = {
      api_key: config.tavilyApiKey,
      query,
      search_depth: 'advanced',
      max_results: 3,
      include_answer: false,
      include_raw_content: false,
    };

    // Tavily supports "days" with topic "news" for recency filtering
    if (since) {
      const sinceMs = new Date(since).getTime();
      const days = Math.max(1, Math.ceil((Date.now() - sinceMs) / 86_400_000));
      if (days <= 365) {
        body.topic = 'news';
        body.days = days;
      }
    }

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { query, results: [], error: `Tavily ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      results?: Array<{
        title: string;
        url: string;
        content: string;
        published_date?: string;
        score?: number;
      }>;
    };

    const result: SearchResult = {
      query,
      results: (data.results ?? []).map(
        (r): SearchItem => ({
          title: r.title,
          url: r.url,
          content: r.content,
          publishedDate: r.published_date,
          score: r.score ?? 0,
        }),
      ),
    };

    cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { query, results: [], error: `Search failed: ${msg}` };
  }
}


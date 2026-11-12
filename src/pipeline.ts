import type { ChatRequest, SSEWriter, MemoryResult, RouterPlan, SearchResult, DiffItem } from './types.js';
import { resolveTemporalRefs } from './temporal.js';
import {
  ensureSession,
  saveMessage,
  getSessionMessages,
  retrieve,
  updateSessionTitle,
  getClaimsByEntities,
  extractSearchKeywords,
} from './memory.js';
import { plan } from './router.js';
import { parallelSearch } from './search.js';
import { synthesize } from './synth.js';
import { extractAndSave, buildDiff } from './claims.js';

export async function runPipeline(req: ChatRequest, writer: SSEWriter): Promise<void> {
  const { sessionId, message, tz, now } = req;
  const startTurn = Date.now();

  ensureSession(sessionId);

  // 1. Persist User Message immediately
  saveMessage(sessionId, 'user', message);
  const sessionHistory = getSessionMessages(sessionId, 10).reverse();

  // ── Step 1: Temporal Resolver (~1ms) ──────────────────────────────────
  writer.step('temporal', 'Resolving temporal references...', undefined, 'running');
  const dateRefs = resolveTemporalRefs(message, tz, now);
  
  const dateDetail = dateRefs.length > 0
    ? dateRefs.map(r => `"${r.text}" (${r.candidates.length} candidates)`).join(', ')
    : 'No temporal references';
  writer.step('temporal', 'Temporal resolution complete', dateDetail, 'done');

  // ── Step 2: Memory Retrieval (~5ms) ───────────────────────────────────
  writer.step('memory', 'Scanning conversation memory...', undefined, 'running');
  
  // Extract filtered topic keywords from message
  const keywords = extractSearchKeywords(message);
  let memory: MemoryResult = retrieve(sessionId, dateRefs, keywords);
  
  const memDetail = memory.status === 'found'
    ? `Found ${memory.messages.length} past messages, ${memory.claims.length} claims`
    : 'No past conversations matched';
  writer.step('memory', 'Memory retrieval complete', memDetail, 'done');

  // ── Step 3: Router (Fast LLM, ~300ms) ─────────────────────────────────
  writer.step('router', 'Planning turn...', undefined, 'running');
  const routerPlan: RouterPlan = await plan(message, memory, dateRefs, now, tz);
  writer.step('router', `Plan: ${routerPlan.mode.toUpperCase()}`, 
    routerPlan.queries.length > 0 ? `Queries: ${routerPlan.queries.join(' | ')}` : undefined, 
    'done'
  );

  // If router identified entities and we haven't loaded claims for them yet, enrich claims
  if (routerPlan.entities.length > 0) {
    const additionalClaims = getClaimsByEntities(routerPlan.entities);
    const existingClaimIds = new Set(memory.claims.map(c => c.id));
    for (const ac of additionalClaims) {
      if (!existingClaimIds.has(ac.id)) {
        memory.claims.push(ac);
        existingClaimIds.add(ac.id);
      }
    }
  }

  // ── Step 4: Parallel Search (if required) ─────────────────────────────
  let searchResults: SearchResult[] = [];
  if (['search', 'recheck'].includes(routerPlan.mode) && routerPlan.queries.length > 0) {
    writer.step('search', `Searching web (${routerPlan.queries.length} queries)...`, undefined, 'running');
    searchResults = await parallelSearch(routerPlan.queries, routerPlan.since);
    
    const totalResults = searchResults.reduce((acc, sr) => acc + sr.results.length, 0);
    writer.step('search', 'Web search complete', `Found ${totalResults} sources`, 'done');
  }

  // ── Step 5: Diff Generation (for recheck mode) ────────────────────────
  let diffItems: DiffItem[] = [];
  if (routerPlan.mode === 'recheck' && memory.claims.length > 0) {
    diffItems = buildDiff(memory.claims, searchResults);
    if (diffItems.length > 0) {
      writer.diff(diffItems);
    }
  }

  // ── Step 6: Synthesis (Strong LLM, streamed) ──────────────────────────
  writer.step('synth', 'Synthesizing response...', undefined, 'running');
  
  const assistantResponse = await synthesize(
    message,
    routerPlan,
    memory,
    searchResults,
    sessionHistory,
    writer,
    now,
    tz
  );

  writer.step('synth', 'Complete', `${((Date.now() - startTurn) / 1000).toFixed(2)}s total`, 'done');
  
  const asOfDateStr = new Date(now).toLocaleString('en-US', { timeZone: tz || 'UTC', dateStyle: 'medium', timeStyle: 'short' });
  writer.done(asOfDateStr);

  // ── Step 7: Async Persist & Claims Ledger ─────────────────────────────
  const assistantMsgId = saveMessage(sessionId, 'assistant', assistantResponse, {
    mode: routerPlan.mode,
    queries: routerPlan.queries,
    asOf: asOfDateStr,
  });

  // Auto-generate a title if session has none yet
  if (sessionHistory.length <= 2) {
    const title = message.slice(0, 40).trim() + (message.length > 40 ? '...' : '');
    updateSessionTitle(sessionId, title);
  }

  // Extract and save verifiable claims asynchronously
  extractAndSave(sessionId, assistantMsgId, assistantResponse).catch(err => {
    console.error('Async claims extraction error:', err);
  });
}


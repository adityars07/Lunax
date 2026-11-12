// ── Date Resolution ─────────────────────────────────────────

export interface DateReference {
  text: string;                    // original text: "last Tuesday"
  candidates: DateCandidate[];
  resolved?: DateCandidate;        // set after memory lookup disambiguates
}

export interface DateCandidate {
  start: Date;
  end: Date;
  label: string;                   // e.g. "Tue, Nov 10, 2026" for display
}

// ── Memory ──────────────────────────────────────────────────

export interface MemoryResult {
  status: 'found' | 'none' | 'ambiguous';
  messages: StoredMessage[];
  claims: StoredClaim[];
  dateRange?: { start: string; end: string };
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  tsUtc: string;
  metaJson?: string | null;
}

export interface StoredClaim {
  id: string;
  sessionId: string;
  msgId: string;
  entity: string;
  attr: string;
  value: string;
  sourceUrl: string | null;
  asOfUtc: string;
}

export interface Session {
  id: string;
  createdAt: string;
  title: string | null;
}

// ── Router ──────────────────────────────────────────────────

export interface RouterPlan {
  mode: 'direct' | 'search' | 'recheck' | 'recall' | 'clarify';
  queries: string[];
  since: string | null;            // ISO date for recency filter
  entities: string[];
  clarifyQuestion: string | null;
  error?: string;
}

// ── Search ──────────────────────────────────────────────────

export interface SearchResult {
  query: string;
  results: SearchItem[];
  error?: string;
}

export interface SearchItem {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
  score: number;
}

// ── Claims ──────────────────────────────────────────────────

export interface ExtractedClaim {
  entity: string;
  attr: string;
  value: string;
  sourceUrl: string | null;
}

export interface DiffItem {
  entity: string;
  attr: string;
  status: 'same' | 'changed' | 'unknown';
  old: string | null;
  now: string | null;
  note: string | null;
}

// ── SSE Writer ──────────────────────────────────────────────

export interface StepEvent {
  id: string;
  label: string;
  detail?: string;
  state: 'running' | 'done' | 'error';
}

export interface SourceItem {
  n: number;
  title: string;
  url: string;
}

export interface SSEWriter {
  step(id: string, label: string, detail?: string, state?: 'running' | 'done' | 'error'): void;
  text(delta: string): void;
  diff(items: DiffItem[]): void;
  sources(items: SourceItem[]): void;
  done(asOf: string): void;
  error(message: string): void;
}

// ── API ─────────────────────────────────────────────────────

export interface ChatRequest {
  sessionId: string;
  message: string;
  tz: string;                      // IANA timezone from the browser
  now: string;                     // ISO 8601 from the browser
}


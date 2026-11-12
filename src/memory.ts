import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { StoredMessage, StoredClaim, MemoryResult, DateReference, Session } from './types.js';
import { config } from './config.js';

let db: Database.Database;

// ── Stopwords and Keyword Extraction ────────────────────────

export const CONVERSATIONAL_STOP_WORDS = new Set([
  // Question words & auxiliaries
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'done', 'can', 'could', 'would', 'should', 'will', 'shall',
  // Pronouns, prepositions, conjunctions
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its',
  'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those', 'there',
  'here', 'with', 'about', 'from', 'into', 'during', 'before', 'after', 'above',
  'below', 'to', 'for', 'of', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'on', 'in', 'at', 'by', 'as', 'and', 'or', 'but', 'if', 'something', 'anything',
  'nothing', 'someone', 'anyone', 'everyone', 'an', 'a',
  // Conversation & meta terms
  'tell', 'told', 'shortlist', 'shortlisted', 'picked', 'pick', 'discussed',
  'discuss', 'asked', 'asking', 'ask', 'said', 'say', 'saying', 'answer',
  'still', 'correct', 'true', 'since', 'last', 'first', 'second', 'also',
  'today', 'yesterday', 'tomorrow', 'week', 'month', 'year', 'days', 'day',
  'tools', 'tool', 'pricing', 'price', 'prices', 'cost', 'costs', 'change',
  'changed', 'changes', 'shipped', 'ship', 'shipping', 'big', 'new', 'latest',
  'options', 'option', 'reps', 'team', 'person', 'people', 'users', 'user',
  // Calendar days/months
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'
]);

export function extractSearchKeywords(message: string): string[] {
  return message
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 1 && isNaN(Number(w)) && !CONVERSATIONAL_STOP_WORDS.has(w));
}

// ── Initialisation ──────────────────────────────────────────

export function initMemory(): void {
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      title      TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content    TEXT NOT NULL,
      ts_utc     TEXT NOT NULL,
      meta_json  TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_msg_session_ts ON messages(session_id, ts_utc);
    CREATE INDEX IF NOT EXISTS idx_msg_ts         ON messages(ts_utc);
  `);

  // FTS5 full-text index on message content
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid'
    );
  `);

  // Keep FTS in sync via triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS fts_delete AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS fts_update AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      msg_id     TEXT NOT NULL,
      entity     TEXT NOT NULL,
      attr       TEXT NOT NULL,
      value      TEXT NOT NULL,
      source_url TEXT,
      as_of_utc  TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (msg_id) REFERENCES messages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_claims_entity  ON claims(entity COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_claims_session  ON claims(session_id);
  `);
}

// ── Session helpers ─────────────────────────────────────────

export function ensureSession(sessionId: string): void {
  const row = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  if (!row) {
    db.prepare('INSERT INTO sessions (id, created_at, title) VALUES (?, ?, ?)').run(
      sessionId,
      new Date().toISOString(),
      null,
    );
  }
}

export function listSessions(): Session[] {
  return db
    .prepare(
      `SELECT id, created_at AS createdAt, title
       FROM sessions ORDER BY created_at DESC LIMIT 50`,
    )
    .all() as Session[];
}

export function updateSessionTitle(sessionId: string, title: string): void {
  db.prepare('UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL').run(
    title,
    sessionId,
  );
}

export function deleteSession(sessionId: string): void {
  db.prepare('DELETE FROM claims   WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// ── Message helpers ─────────────────────────────────────────

export function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  meta?: Record<string, unknown>,
): string {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, ts_utc, meta_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, role, content, new Date().toISOString(), meta ? JSON.stringify(meta) : null);
  return id;
}

export function getSessionMessages(sessionId: string, limit = 50): StoredMessage[] {
  return db
    .prepare(
      `SELECT id, session_id AS sessionId, role, content,
              ts_utc AS tsUtc, meta_json AS metaJson
       FROM messages
       WHERE session_id = ?
       ORDER BY ts_utc DESC
       LIMIT ?`,
    )
    .all(sessionId, limit) as StoredMessage[];
}

// ── Memory retrieval ────────────────────────────────────────

/**
 * Retrieve past conversations matching date references and/or keywords.
 * Date candidates are tried in order; the first match wins and resolves the ref.
 */
export function retrieve(
  currentSessionId: string,
  dateRefs: DateReference[],
  keywords: string[],
): MemoryResult {
  // 1. Try each date candidate
  for (const ref of dateRefs) {
    for (const candidate of ref.candidates) {
      const startUtc = candidate.start.toISOString();
      const endUtc = candidate.end.toISOString();

      const messages = keywords.length > 0
        ? queryDateAndKeywords(startUtc, endUtc, keywords, currentSessionId)
        : queryDateOnly(startUtc, endUtc, currentSessionId);

      if (messages.length > 0) {
        ref.resolved = candidate;
        return {
          status: 'found',
          messages,
          claims: claimsForMessages(messages.map((m) => m.id)),
          dateRange: { start: startUtc, end: endUtc },
        };
      }
    }
  }

  // 2. No date refs → keyword-only search
  if (dateRefs.length === 0 && keywords.length > 0) {
    const messages = queryKeywordsOnly(keywords, currentSessionId);
    if (messages.length > 0) {
      return {
        status: 'found',
        messages,
        claims: claimsForMessages(messages.map((m) => m.id)),
      };
    }
  }

  return { status: 'none', messages: [], claims: [] };
}

function queryDateAndKeywords(
  startUtc: string,
  endUtc: string,
  keywords: string[],
  excludeSession: string,
): StoredMessage[] {
  const ftsExpr = keywords.map((k) => `"${k.replace(/"/g, '')}"`).join(' AND ');
  try {
    return db
      .prepare(
        `SELECT m.id, m.session_id AS sessionId, m.role, m.content,
                m.ts_utc AS tsUtc, m.meta_json AS metaJson
         FROM messages m
         JOIN messages_fts fts ON fts.rowid = m.rowid
         WHERE fts.content MATCH ?
           AND m.ts_utc >= ? AND m.ts_utc <= ?
           AND m.session_id != ?
         ORDER BY m.ts_utc ASC
         LIMIT 30`,
      )
      .all(ftsExpr, startUtc, endUtc, excludeSession) as StoredMessage[];
  } catch {
    return [];
  }
}

function queryDateOnly(startUtc: string, endUtc: string, excludeSession: string): StoredMessage[] {
  return db
    .prepare(
      `SELECT id, session_id AS sessionId, role, content,
              ts_utc AS tsUtc, meta_json AS metaJson
       FROM messages
       WHERE ts_utc >= ? AND ts_utc <= ? AND session_id != ?
       ORDER BY ts_utc ASC
       LIMIT 30`,
    )
    .all(startUtc, endUtc, excludeSession) as StoredMessage[];
}

function queryKeywordsOnly(keywords: string[], excludeSession: string): StoredMessage[] {
  const ftsExpr = keywords.map((k) => `"${k.replace(/"/g, '')}"`).join(' OR ');
  try {
    return db
      .prepare(
        `SELECT m.id, m.session_id AS sessionId, m.role, m.content,
                m.ts_utc AS tsUtc, m.meta_json AS metaJson
         FROM messages m
         JOIN messages_fts fts ON fts.rowid = m.rowid
         WHERE fts.content MATCH ?
           AND m.session_id != ?
         ORDER BY rank
         LIMIT 20`,
      )
      .all(ftsExpr, excludeSession) as StoredMessage[];
  } catch {
    return [];
  }
}

// ── Claims helpers ──────────────────────────────────────────

function claimsForMessages(msgIds: string[]): StoredClaim[] {
  if (msgIds.length === 0) return [];
  const ph = msgIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT id, session_id AS sessionId, msg_id AS msgId, entity, attr,
              value, source_url AS sourceUrl, as_of_utc AS asOfUtc
       FROM claims WHERE msg_id IN (${ph})
       ORDER BY as_of_utc DESC`,
    )
    .all(...msgIds) as StoredClaim[];
}

export function getClaimsByEntities(entities: string[]): StoredClaim[] {
  if (entities.length === 0) return [];
  const ph = entities.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT id, session_id AS sessionId, msg_id AS msgId, entity, attr,
              value, source_url AS sourceUrl, as_of_utc AS asOfUtc
       FROM claims WHERE entity COLLATE NOCASE IN (${ph})
       ORDER BY as_of_utc DESC`,
    )
    .all(...entities) as StoredClaim[];
}

export function saveClaims(
  sessionId: string,
  msgId: string,
  claims: { entity: string; attr: string; value: string; sourceUrl: string | null }[],
): void {
  const stmt = db.prepare(
    `INSERT INTO claims (id, session_id, msg_id, entity, attr, value, source_url, as_of_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const insertAll = db.transaction((items: typeof claims) => {
    for (const c of items) {
      stmt.run(uuidv4(), sessionId, msgId, c.entity, c.attr, c.value, c.sourceUrl, now);
    }
  });
  insertAll(claims);
}

// ── Formatting for prompts ──────────────────────────────────

export function formatMemoryForPrompt(result: MemoryResult): string {
  if (result.status === 'none' || result.messages.length === 0) return '';

  return result.messages
    .map((m) => {
      const d = new Date(m.tsUtc).toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `[${d}] ${m.role}: ${m.content}`;
    })
    .join('\n\n');
}

export function formatClaimsForPrompt(claims: StoredClaim[]): string {
  if (claims.length === 0) return '';
  return claims
    .map(
      (c) =>
        `• ${c.entity} / ${c.attr}: ${c.value} (as of ${new Date(c.asOfUtc).toLocaleDateString('en-US')}${c.sourceUrl ? `, source: ${c.sourceUrl}` : ''})`,
    )
    .join('\n');
}


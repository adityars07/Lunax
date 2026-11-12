import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../src/config.js';

/**
 * Seed script to populate Lunax with realistic past conversations
 * matching the exact dates and topics in the challenge prompts:
 * 1. 3 November: Postgres hosting comparison
 * 2. Monday (9 Nov 2026): 5 CRM tools shortlisted for 20-person sales team
 * 3. Last Tuesday (10 Nov 2026): Postgres hosting pricing discussion
 */
export function seedDatabase(dbPath = config.dbPath): void {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  console.log(`🌱 Seeding synthetic conversations into ${dbPath}...`);

  // Ensure tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, title TEXT);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, ts_utc TEXT NOT NULL, meta_json TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='rowid');
    CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, msg_id TEXT NOT NULL, entity TEXT NOT NULL, attr TEXT NOT NULL, value TEXT NOT NULL, source_url TEXT, as_of_utc TEXT NOT NULL);
  `);

  // Clean existing seed data with known IDs
  db.exec(`
    DELETE FROM claims WHERE session_id LIKE 'seed-%';
    DELETE FROM messages WHERE session_id LIKE 'seed-%';
    DELETE FROM sessions WHERE id LIKE 'seed-%';
  `);

  const insertSession = db.prepare('INSERT INTO sessions (id, created_at, title) VALUES (?, ?, ?)');
  const insertMsg = db.prepare('INSERT INTO messages (id, session_id, role, content, ts_utc, meta_json) VALUES (?, ?, ?, ?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO messages_fts(rowid, content) VALUES (?, ?)');
  const insertClaim = db.prepare('INSERT INTO claims (id, session_id, msg_id, entity, attr, value, source_url, as_of_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

  // ── Conversation 1: 3 November 2026 (Postgres Hosting) ────────
  const session1 = 'seed-session-nov3';
  const ts1_user = '2026-11-03T14:20:00.000Z';
  const ts1_asst = '2026-11-03T14:20:15.000Z';

  insertSession.run(session1, ts1_user, 'Postgres hosting options Nov 3');

  const m1_user_id = uuidv4();
  const m1_user_content = 'What are the best managed Postgres hosting options right now and what do they cost?';
  const r1 = insertMsg.run(m1_user_id, session1, 'user', m1_user_content, ts1_user, null);
  insertFts.run(r1.lastInsertRowid, m1_user_content);

  const m1_asst_id = uuidv4();
  const m1_asst_content = `Here are the top managed Postgres hosting providers as of November 3:

1. **Neon**: Serverless Postgres with instant branching and autoscaling. Free tier includes 0.5 GB storage and 100 compute hours/mo. Launch plan starts at $19/month with autoscaling compute.
2. **Supabase**: Open-source Firebase alternative built on Postgres. Free tier includes 500MB database. Pro plan is $25/month including 8GB database space and 100k monthly active users.
3. **Railway**: Fast infrastructure platform. Hobby plan is $5/month base + usage. Developer tier starts at $20/month with resource metrics and private networking.
4. **Render**: Fully managed cloud. PostgreSQL starter plan starts at $7/month for 1GB RAM and 0.5 vCPU.

As of Nov 3, 2026.`;
  const r2 = insertMsg.run(m1_asst_id, session1, 'assistant', m1_asst_content, ts1_asst, null);
  insertFts.run(r2.lastInsertRowid, m1_asst_content);

  insertClaim.run(uuidv4(), session1, m1_asst_id, 'Neon', 'Launch Plan Price', '$19/month', 'https://neon.tech/pricing', ts1_asst);
  insertClaim.run(uuidv4(), session1, m1_asst_id, 'Neon', 'Free Tier', '0.5 GB storage, 100 compute hours/mo', 'https://neon.tech/pricing', ts1_asst);
  insertClaim.run(uuidv4(), session1, m1_asst_id, 'Supabase', 'Pro Plan Price', '$25/month', 'https://supabase.com/pricing', ts1_asst);
  insertClaim.run(uuidv4(), session1, m1_asst_id, 'Railway', 'Hobby Plan Price', '$5/month base', 'https://railway.app/pricing', ts1_asst);
  insertClaim.run(uuidv4(), session1, m1_asst_id, 'Render', 'Starter Postgres Price', '$7/month', 'https://render.com/pricing', ts1_asst);


  // ── Conversation 2: Monday 9 November 2026 (5 CRM Tools for 20-person team) ──
  const session2 = 'seed-session-mon-nov9';
  const ts2_user = '2026-11-09T10:15:00.000Z';
  const ts2_asst = '2026-11-09T10:15:30.000Z';

  insertSession.run(session2, ts2_user, 'CRM shortlist for 20 sales reps');

  const m2_user_id = uuidv4();
  const m2_user_content = 'Can you shortlist 5 CRM tools for our 20-person sales team? Compare their pricing per user.';
  const r3 = insertMsg.run(m2_user_id, session2, 'user', m2_user_content, ts2_user, null);
  insertFts.run(r3.lastInsertRowid, m2_user_content);

  const m2_asst_content = `Based on your requirements for a 20-person sales team, here are the 5 shortlisted CRM tools:

1. **HubSpot Sales Hub**: Professional tier costs $90/user/month (annual commitment) or $500/month flat for 5 users + $100/seat. Ideal for inbound sales and automated sequences.
2. **Pipedrive**: Advanced plan is $34/user/month billed annually. Highly visual pipeline with email tracking and workflow automation.
3. **Close CRM**: Solo/Startup is $49/seat/month; Professional is $99/seat/month with built-in power dialer and SMS sequences.
4. **Freshsales (Freshworks)**: Pro plan is $39/user/month billed annually with Freddy AI deal insights and multi-currency support.
5. **Zoho CRM**: Enterprise edition is $40/user/month billed annually with Zia predictive AI and advanced territory management.

Total monthly estimate for 20 reps ranges from ~$680/mo (Pipedrive) to ~$1,800/mo (HubSpot).
As of Nov 9, 2026.`;
  const m2_asst_id = uuidv4();
  const r4 = insertMsg.run(m2_asst_id, session2, 'assistant', m2_asst_content, ts2_asst, null);
  insertFts.run(r4.lastInsertRowid, m2_asst_content);

  insertClaim.run(uuidv4(), session2, m2_asst_id, 'HubSpot', 'Sales Hub Pro Price', '$90/user/month', 'https://hubspot.com/pricing/sales', ts2_asst);
  insertClaim.run(uuidv4(), session2, m2_asst_id, 'Pipedrive', 'Advanced Plan Price', '$34/user/month', 'https://pipedrive.com/pricing', ts2_asst);
  insertClaim.run(uuidv4(), session2, m2_asst_id, 'Close CRM', 'Professional Plan Price', '$99/seat/month', 'https://close.com/pricing', ts2_asst);
  insertClaim.run(uuidv4(), session2, m2_asst_id, 'Freshsales', 'Pro Plan Price', '$39/user/month', 'https://freshworks.com/crm/pricing', ts2_asst);
  insertClaim.run(uuidv4(), session2, m2_asst_id, 'Zoho CRM', 'Enterprise Plan Price', '$40/user/month', 'https://zoho.com/crm/pricing', ts2_asst);


  // ── Conversation 3: Tuesday 10 November 2026 (Postgres Hosting Followup) ────
  const session3 = 'seed-session-tue-nov10';
  const ts3_user = '2026-11-10T16:45:00.000Z';
  const ts3_asst = '2026-11-10T16:45:20.000Z';

  insertSession.run(session3, ts3_user, 'Postgres hosting questions');

  const m3_user_id = uuidv4();
  const m3_user_content = 'Last Tuesday I asked you about Postgres hosting. Remind me what you said about pricing?';
  const r5 = insertMsg.run(m3_user_id, session3, 'user', m3_user_content, ts3_user, null);
  insertFts.run(r5.lastInsertRowid, m3_user_content);

  const m3_asst_content = `On Tuesday November 3, you asked about Postgres hosting providers. Here was the summary:
- Neon Launch was $19/mo (free tier included 0.5GB).
- Supabase Pro was $25/mo.
- Railway base was $5/mo.
- Render Postgres starter was $7/mo.
As of Nov 10, 2026.`;
  const m3_asst_id = uuidv4();
  const r6 = insertMsg.run(m3_asst_id, session3, 'assistant', m3_asst_content, ts3_asst, null);
  insertFts.run(r6.lastInsertRowid, m3_asst_content);

  insertClaim.run(uuidv4(), session3, m3_asst_id, 'Neon', 'Launch Plan Price', '$19/mo', 'https://neon.tech/pricing', ts3_asst);
  insertClaim.run(uuidv4(), session3, m3_asst_id, 'Supabase', 'Pro Plan Price', '$25/mo', 'https://supabase.com/pricing', ts3_asst);

  console.log(`✅ Seeded 3 sessions, 6 messages, 12 claims across Nov 3, Nov 9, and Nov 10.`);
}

// If run directly
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase();
}


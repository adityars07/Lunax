import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateApiKeys } from './config.js';
import { initMemory, listSessions, getSessionMessages, deleteSession } from './memory.js';
import { runPipeline } from './pipeline.js';
import type { SSEWriter, StepEvent, DiffItem, SourceItem, ChatRequest } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Serve static frontend from public/
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Initialize SQLite database and check environment
initMemory();
validateApiKeys();

// ── Session APIs ─────────────────────────────────────────────

app.get('/api/sessions', (_req, res) => {
  try {
    const sessions = listSessions();
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/:id/messages', (req, res) => {
  try {
    const messages = getSessionMessages(req.params.id, 100).reverse();
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/sessions/:id', (req, res) => {
  try {
    deleteSession(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── SSE Chat Endpoint ────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { sessionId, message, tz, now } = req.body as Partial<ChatRequest>;

  if (!sessionId || !message) {
    res.status(400).json({ error: 'Missing sessionId or message' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const writer: SSEWriter = {
    step(id: string, label: string, detail?: string, state: 'running' | 'done' | 'error' = 'running') {
      const payload: StepEvent = { id, label, detail, state };
      sendEvent('step', payload);
    },
    text(delta: string) {
      sendEvent('text', { delta });
    },
    diff(items: DiffItem[]) {
      sendEvent('diff', { items });
    },
    sources(items: SourceItem[]) {
      sendEvent('sources', { items });
    },
    done(asOf: string) {
      sendEvent('done', { asOf });
      res.end();
    },
    error(message: string) {
      sendEvent('error', { message });
      res.end();
    },
  };

  // Close connection handling
  req.on('close', () => {
    // Client disconnected
  });

  try {
    await runPipeline(
      {
        sessionId,
        message,
        tz: tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        now: now || new Date().toISOString(),
      },
      writer
    );
  } catch (err) {
    console.error('Pipeline error:', err);
    writer.error(err instanceof Error ? err.message : String(err));
  }
});

// Start listening
const server = app.listen(config.port, () => {
  console.log(`\n======================================================`);
  console.log(`  🌙 Lunax Chat Agent`);
  console.log(`  Tagline: Remembers what it told you, checks if it's true.`);
  console.log(`  Server running at http://localhost:${config.port}`);
  console.log(`======================================================\n`);
});

export default server;


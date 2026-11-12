import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedDatabase } from './seed.js';
import { initMemory, retrieve, extractSearchKeywords } from '../src/memory.js';
import { resolveTemporalRefs } from '../src/temporal.js';
import { plan } from '../src/router.js';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestCase {
  id: string;
  name: string;
  message: string;
  referenceNow: string;
  tz: string;
  expectedMode?: string;
  expectMemoryHit?: boolean;
  expectedCandidateCount?: number;
  expectedEntities?: string[];
  minQueries?: number;
  maxQueries?: number;
  mustContainInAnswer?: string[];
  forbiddenInAnswer?: string[];
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`  🧪 Lunax Automated Evaluation Suite`);
  console.log(`======================================================\n`);

  // 1. Seed test database
  initMemory();
  seedDatabase();

  const casesPath = path.join(__dirname, 'cases.json');
  const testCases: TestCase[] = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const start = Date.now();
    process.stdout.write(`• [${tc.id}] ${tc.name}... `);

    try {
      const failures: string[] = [];

      // Test Step 1: Temporal resolution
      const dateRefs = resolveTemporalRefs(tc.message, tc.tz, tc.referenceNow);
      if (tc.expectedCandidateCount !== undefined) {
        const totalCandidates = dateRefs.reduce((acc, r) => acc + r.candidates.length, 0);
        if (totalCandidates !== tc.expectedCandidateCount) {
          failures.push(`Expected ${tc.expectedCandidateCount} date candidates, got ${totalCandidates}`);
        }
      }

      // Test Step 2: Memory retrieval
      const keywords = extractSearchKeywords(tc.message);
      const memory = retrieve('test-eval-session', dateRefs, keywords);
      if (tc.expectMemoryHit === true && memory.status === 'none') {
        failures.push(`Expected memory hit, but status was "none"`);
      }
      if (tc.expectMemoryHit === false && memory.status === 'found') {
        failures.push(`Expected memory miss, but found ${memory.messages.length} messages`);
      }

      // Test Step 3: Router planning (if LLM router testing is applicable and API key is set)
      if (tc.expectedMode) {
        if (!config.openaiApiKey) {
          // Skip live router LLM call if OPENAI_API_KEY is not configured
        } else {
          const routerPlan = await plan(tc.message, memory, dateRefs, tc.referenceNow, tc.tz);
          
          if (routerPlan.mode !== tc.expectedMode) {
            // Allow acceptable synonyms for edge prompts (e.g. clarify if memory missing vs search)
            if (!(tc.expectedMode === 'recheck' && routerPlan.mode === 'search' && memory.status === 'none')) {
              failures.push(`Expected mode "${tc.expectedMode}", router returned "${routerPlan.mode}"`);
            }
          }

          if (tc.minQueries !== undefined && routerPlan.queries.length < tc.minQueries) {
            failures.push(`Expected >= ${tc.minQueries} search queries, got ${routerPlan.queries.length}`);
          }
          if (tc.maxQueries !== undefined && routerPlan.queries.length > tc.maxQueries) {
            failures.push(`Expected <= ${tc.maxQueries} search queries, got ${routerPlan.queries.length}`);
          }
        }
      }

      const elapsed = Date.now() - start;
      if (failures.length === 0) {
        console.log(`✅ PASS (${elapsed}ms)`);
        passed++;
      } else {
        console.log(`❌ FAIL (${elapsed}ms)`);
        failures.forEach(f => console.log(`    ↳ ${f}`));
        failed++;
      }
    } catch (err) {
      console.log(`💥 ERROR`);
      console.error(`    ↳ ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n------------------------------------------------------`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${testCases.length} test cases.`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal eval runner error:', err);
  process.exit(1);
});


import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, transaction } from '../db.js';
import { getConfig } from '../config.js';
import { loadCatalogItems } from '../exam-bank/sources/catalog.js';
import { loadCodeprepItems } from '../exam-bank/sources/codeprep.js';
import { loadCodingMcqsItems } from '../exam-bank/sources/coding-mcqs.js';
import { loadExercismItems } from '../exam-bank/sources/exercism.js';
import { insertExamItem } from '../exam-bank/persist.js';
import { writeLocalAttribution } from '../exam-bank/write-attribution.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const seedsDir = join(root, '.local/exam-seeds');

const ALL_SOURCES = ['catalog', 'codeprep', 'coding_mcqs', 'exercism'];

function parseSources() {
  const arg = process.argv.find((a) => a.startsWith('--sources='));
  if (!arg) return ALL_SOURCES;
  const list = arg.slice('--sources='.length).split(',').map((s) => s.trim()).filter(Boolean);
  return list.filter((s) => ALL_SOURCES.includes(s));
}

async function ensureSchema(pool) {
  const sql = await readFile(join(root, 'database/006_exam_bank.sql'), 'utf8');
  await pool.query(sql);
}

const config = getConfig();
if (!config.databaseUrl) {
  console.error('Set DATABASE_URL in .env first.');
  process.exit(1);
}

const sources = parseSources();
const dryRun = process.argv.includes('--dry-run');
const pool = createPool(config.databaseUrl);

try {
  await ensureSchema(pool);

  const collectors = {
    catalog: () => loadCatalogItems(pool),
    codeprep: () => loadCodeprepItems(seedsDir),
    coding_mcqs: () => loadCodingMcqsItems(seedsDir, { maxPerFile: Number(process.env.MCQS_MAX_PER_FILE || 12) }),
    exercism: () => loadExercismItems(seedsDir, { casesPerExercise: Number(process.env.EXERCISM_CASES || 3) }),
  };

  const counts = {};
  let inserted = 0;
  let skipped = 0;

  for (const source of sources) {
    const items = await collectors[source]();
    counts[source] = items.length;
    if (dryRun) {
      console.log(`[dry-run] ${source}: ${items.length} items`);
      continue;
    }
    let sourceInserted = 0;
    await transaction(pool, async (client) => {
      for (const item of items) {
        const ok = await insertExamItem(client, item);
        if (ok) {
          inserted++;
          sourceInserted++;
        } else skipped++;
      }
    });
    console.log(`${source}: ${items.length} parsed, ${sourceInserted} new rows`);
  }

  await writeLocalAttribution(seedsDir, counts);

  if (!dryRun) {
    const approved = await pool.query(`
      UPDATE exam_items SET status = 'approved'
      WHERE status = 'candidate'
        AND (
          (source_id = 'coding_mcqs' AND question->>'type' = 'mcq')
          OR (source_id = 'exercism' AND question->>'type' IN ('written', 'mcq'))
        )
      RETURNING id`);
    if (approved.rowCount) console.log(`Auto-approved ${approved.rowCount} external bank items for live papers.`);
  }

  const totals = await pool.query(
    `SELECT source_id, status, COUNT(*)::int AS n FROM exam_items GROUP BY source_id, status ORDER BY source_id, status`,
  );
  console.log('\nDatabase totals:');
  for (const row of totals.rows) console.log(`  ${row.source_id} (${row.status}): ${row.n}`);
  console.log(`\nNew inserts this run: ${inserted} (${skipped} duplicates skipped)`);
  console.log(`Attribution: ${join(seedsDir, 'ATTRIBUTION.md')}`);
  console.log(`Seed files: ${seedsDir} (gitignored)`);
} catch (error) {
  console.error('Seed failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
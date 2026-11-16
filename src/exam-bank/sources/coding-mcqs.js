import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { normalizeMcq, slugId } from '../normalize.js';
import { skillSlugForTopicPath } from '../skill-map.js';

const TREE_URL = 'https://api.github.com/repos/alidevhere/Coding_MCQs/git/trees/master?recursive=1';
const RAW_BASE = 'https://raw.githubusercontent.com/alidevhere/Coding_MCQs/master/';

function parseCsvRow(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  if (parts.length < 6) return null;
  const [n, statement, a, b, c, d, ans] = parts;
  void n;
  if (!statement || !a || !b || !c || !d || !ans) return null;
  const letter = String(ans).trim().toLowerCase().charAt(0);
  const optMap = { a, b, c, d };
  const correct = optMap[letter];
  if (!correct) return null;
  return {
    statement: statement.replace(/\s+/g, ' '),
    options: [a, b, c, d],
    correctAnswer: correct,
  };
}

export async function downloadCodingMcqsCsvs(seedsDir) {
  const csvRoot = join(seedsDir, 'coding-mcqs-csv');
  await mkdir(csvRoot, { recursive: true });
  const response = await fetch(TREE_URL);
  if (!response.ok) throw new Error(`Coding_MCQs tree fetch failed: ${response.status}`);
  const tree = await response.json();
  const paths = (tree.tree || [])
    .map((t) => t.path)
    .filter((p) => p.startsWith('CSV_Files/') && p.endsWith('.csv'));
  let downloaded = 0;
  for (const path of paths) {
    const localPath = join(csvRoot, path.replace(/^CSV_Files\//, ''));
    await mkdir(join(localPath, '..'), { recursive: true });
    try {
      await readFile(localPath, 'utf8');
      continue;
    } catch {
      const url = RAW_BASE + encodeURI(path).replace(/%2F/g, '/');
      const fileRes = await fetch(url);
      if (!fileRes.ok) continue;
      await writeFile(localPath, await fileRes.text(), 'utf8');
      downloaded++;
    }
  }
  return { csvRoot, fileCount: paths.length, downloaded };
}

export async function loadCodingMcqsItems(seedsDir, { maxPerFile = 15 } = {}) {
  const { csvRoot } = await downloadCodingMcqsCsvs(seedsDir);
  const items = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.csv')) {
        const rel = relative(csvRoot, full);
        const skillSlug = skillSlugForTopicPath(rel) || 'javascript';
        const text = await readFile(full, 'utf8');
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        let taken = 0;
        for (let i = 0; i < lines.length && taken < maxPerFile; i++) {
          const parsed = parseCsvRow(lines[i]);
          if (!parsed) continue;
          const externalId = `mcqs:${rel}:${i}`;
          const q = normalizeMcq({
            id: slugId(`mcq-${rel}-${i}`, 70),
            prompt: parsed.statement,
            options: parsed.options,
            correctAnswer: parsed.correctAnswer,
            points: 10,
          });
          if (!q) continue;
          items.push({
            sourceId: 'coding_mcqs',
            externalId,
            objectiveCode: `mcqs:${basename(rel, '.csv')}`,
            objectiveStatement: `DSA topic: ${rel}`,
            skillSlug,
            activityId: null,
            status: 'candidate',
            question: q,
            metadata: { csvPath: rel, row: i },
          });
          taken++;
        }
      }
    }
  }

  await walk(csvRoot);
  return items;
}
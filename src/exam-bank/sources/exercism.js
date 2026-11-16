import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeWritten, slugId } from '../normalize.js';

const RAW_BASE = 'https://raw.githubusercontent.com/exercism/problem-specifications/main/exercises';
/** Small JS-friendly set; expand later from the track syllabus */
const EXERCISE_SLUGS = [
  'luhn',
  'hamming',
  'raindrops',
  'resistor-color',
  'reverse-string',
  'two-fer',
  'acronym',
  'allergies',
  'binary',
  'palindrome-products',
];

export async function ensureExercismExercise(seedsDir, slug) {
  const dir = join(seedsDir, 'exercism');
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${slug}.json`);
  try {
    await readFile(target, 'utf8');
    return target;
  } catch {
    const url = `${RAW_BASE}/${slug}/canonical-data.json`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = await response.text();
    await writeFile(target, text, 'utf8');
    return target;
  }
}

export async function loadExercismItems(seedsDir, { casesPerExercise = 4 } = {}) {
  const items = [];
  for (const slug of EXERCISE_SLUGS) {
    const path = await ensureExercismExercise(seedsDir, slug);
    if (!path) continue;
    let data;
    try {
      data = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      continue;
    }
    const cases = (data.cases || []).slice(0, casesPerExercise);
    for (const c of cases) {
      const externalId = `exercism:${slug}:${c.uuid || c.description}`;
      const prompt = `[${slug}] ${c.description || c.property}\n\nInput: ${JSON.stringify(c.input)}`;
      const expected = JSON.stringify(c.expected);
      const question = normalizeWritten({
        id: slugId(`ex-${slug}-${c.uuid || c.description}`, 70),
        prompt,
        rubric: `Expected result: ${expected}. Award full credit for a correct, concise explanation or implementation approach that handles this case.`,
        points: 15,
      });
      if (!question) continue;
      items.push({
        sourceId: 'exercism',
        externalId: slugId(externalId, 180),
        objectiveCode: `exercism:${slug}`,
        objectiveStatement: `Exercism: ${slug} — ${c.property || 'practice'}`,
        skillSlug: 'javascript',
        activityId: null,
        status: 'candidate',
        question,
        metadata: { slug, property: c.property, uuid: c.uuid },
      });
    }
  }
  return items;
}
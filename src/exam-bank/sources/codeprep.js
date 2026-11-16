import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeMcq, normalizeWritten } from '../normalize.js';
import { skillSlugForTechnology } from '../skill-map.js';

const CODEPREP_URL =
  'https://raw.githubusercontent.com/codeprepdev/codeprep-questions/main/data/questions.json';

export async function ensureCodeprepFile(seedsDir) {
  await mkdir(seedsDir, { recursive: true });
  const target = join(seedsDir, 'codeprep-questions.json');
  try {
    await readFile(target, 'utf8');
    return target;
  } catch {
    const response = await fetch(CODEPREP_URL);
    if (!response.ok) throw new Error(`CodePrep download failed: ${response.status}`);
    const text = await response.text();
    await writeFile(target, text, 'utf8');
    return target;
  }
}

function lineOptions(buggyLines, code) {
  const lines = String(code).split('\n');
  const nums = buggyLines?.length ? buggyLines.map(Number) : [1];
  const opts = nums.map((n) => `Line ${n}: ${(lines[n - 1] || '').trim().slice(0, 120)}`);
  const correct = opts[0] || 'Line 1';
  while (opts.length < 4) opts.push(`Line ${opts.length + 1}: (other)`);
  return { options: opts.slice(0, 4), correctAnswer: correct };
}

export async function loadCodeprepItems(seedsDir) {
  const file = await ensureCodeprepFile(seedsDir);
  const data = JSON.parse(await readFile(file, 'utf8'));
  const items = [];
  for (const q of data.questions || []) {
    const tech = q.technology || 'javascript';
    const skillSlug = skillSlugForTechnology(tech);
    const externalId = q.id;
    const objectiveCode = `codeprep:${tech}:${q.id}`;
    let question = null;
    const basePoints = q.difficulty >= 4 ? 15 : 10;

    if (q.type === 'MCQ_SINGLE' && q.answer?.options?.length) {
      const flatOptions = q.answer.options.map((o) =>
        typeof o === 'string' ? o : o.text || o.label || String(o.id || ''),
      );
      const byId = Object.fromEntries(
        q.answer.options.filter((o) => o && typeof o === 'object' && o.id).map((o) => [o.id, o.text || o.label]),
      );
      const correctOption =
        byId[q.answer.correctOptionId] ||
        flatOptions.find((_, i) => String(i) === String(q.answer.correctOptionId)) ||
        flatOptions[0];
      question = normalizeMcq({
        id: `cp-${q.id}`,
        prompt: q.prompt,
        options: flatOptions,
        correctAnswer: correctOption,
        points: basePoints,
      });
    } else if (q.type === 'TRUE_FALSE') {
      const truth = Boolean(q.answer?.value);
      question = normalizeMcq({
        id: `cp-${q.id}`,
        prompt: q.prompt,
        options: ['True', 'False'],
        correctAnswer: truth ? 'True' : 'False',
        points: basePoints,
      });
    } else if (q.type === 'FIND_THE_BUG') {
      const codeBlock = q.answer?.code ? `\n\n\`\`\`javascript\n${q.answer.code}\n\`\`\`` : '';
      if (q.answer?.options?.length) {
        const flatOptions = q.answer.options.map((o) => (typeof o === 'string' ? o : o.text || ''));
        const byId = Object.fromEntries(
          q.answer.options.filter((o) => o && typeof o === 'object' && o.id).map((o) => [o.id, o.text]),
        );
        question = normalizeMcq({
          id: `cp-${q.id}`,
          prompt: `${q.prompt}${codeBlock}`,
          options: flatOptions,
          correctAnswer: byId[q.answer.correctOptionId] || flatOptions[0],
          points: basePoints + 10,
        });
      } else if (q.answer?.code) {
        const { options, correctAnswer } = lineOptions(q.answer.buggyLines, q.answer.code);
        question = normalizeMcq({
          id: `cp-${q.id}`,
          prompt: `${q.prompt}${codeBlock}`,
          options,
          correctAnswer,
          points: basePoints + 10,
        });
      }
    } else if (q.type === 'SHORT_ANSWER' || q.type === 'FLASHCARD') {
      const sample = q.answer?.sampleAnswer || q.answer?.back || '';
      question = normalizeWritten({
        id: `cp-${q.id}`,
        prompt: q.prompt,
        rubric: `Expected themes: ${sample}\n\nSource explanation (admin reference): ${q.explanation || ''}`.slice(0, 3000),
        points: basePoints + 10,
      });
    } else if (q.type === 'CODE_OUTPUT' && q.answer?.options?.length) {
      const flatOptions = q.answer.options.map((o) => (typeof o === 'string' ? o : o.text || ''));
      const correct =
        flatOptions.find((_, i) => String(i) === String(q.answer.correctOptionId)) ||
        q.answer.expectedOutput ||
        flatOptions[0];
      const codeBlock = q.answer.code ? `\n\n\`\`\`${q.answer.language || 'javascript'}\n${q.answer.code}\n\`\`\`` : '';
      question = normalizeMcq({
        id: `cp-${q.id}`,
        prompt: `${q.prompt}${codeBlock}`,
        options: flatOptions,
        correctAnswer: correct,
        points: basePoints + 5,
      });
    }

    if (!question) continue;
    items.push({
      sourceId: 'codeprep',
      externalId,
      objectiveCode,
      objectiveStatement: `${tech}: ${(q.tags || []).join(', ') || q.type}`,
      skillSlug,
      activityId: null,
      status: 'approved',
      question,
      metadata: { technology: tech, type: q.type, difficulty: q.difficulty, explanation: q.explanation },
    });
  }
  return items;
}
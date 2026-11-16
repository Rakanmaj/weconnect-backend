const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

export function slugId(value, max = 80) {
  const base = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return base || 'item';
}

export function normalizeMcq({ id, prompt, options, correctAnswer, points = 10 }) {
  const cleanOptions = [...new Set(options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 8);
  if (cleanOptions.length < 2) return null;
  const correct = String(correctAnswer).trim();
  if (!cleanOptions.includes(correct)) return null;
  const qid = slugId(id, 80);
  if (!ID_RE.test(qid)) return null;
  return {
    id: qid,
    type: 'mcq',
    prompt: String(prompt).trim().slice(0, 5000),
    points,
    options: cleanOptions,
    correctAnswer: correct,
    starterCode: '',
    rubric: '',
    tests: [],
  };
}

export function normalizeWritten({ id, prompt, rubric, points = 20 }) {
  const qid = slugId(id, 80);
  if (!ID_RE.test(qid)) return null;
  const text = String(prompt).trim();
  if (text.length < 5) return null;
  return {
    id: qid,
    type: 'written',
    prompt: text.slice(0, 5000),
    points,
    options: [],
    correctAnswer: '',
    starterCode: '',
    rubric: String(rubric || 'Administrator grades against the stated learning objective.').slice(0, 3000),
    tests: [],
  };
}

export function normalizeCode({ id, prompt, tests, points = 30, starterCode }) {
  const qid = slugId(id, 80);
  if (!ID_RE.test(qid)) return null;
  const cases = (tests || []).slice(0, 5).map((t, i) => ({
    name: String(t.name || `case-${i + 1}`).slice(0, 120),
    input: String(t.input ?? '').slice(0, 2000),
    output: String(t.output ?? '').slice(0, 2000),
  }));
  if (!cases.length) return null;
  return {
    id: qid,
    type: 'code',
    prompt: String(prompt).trim().slice(0, 5000),
    points,
    options: [],
    correctAnswer: '',
    starterCode:
      starterCode ||
      "// Read stdin and write the required result to stdout.\nconst fs = require('node:fs');\nconst input = fs.readFileSync(0, 'utf8').trim();\n",
    rubric:
      'Award 50% for passing the stated example tests, 25% for handling invalid or edge input, and 25% for clear structure.',
    tests: cases,
  };
}
import { normalizeCode, normalizeMcq, normalizeWritten, slugId } from './normalize.js';

function seedView(question) {
  return {
    type: question.type,
    prompt: question.prompt,
    options: question.options || [],
    correctAnswer: question.correctAnswer || '',
    rubric: question.rubric || '',
    tests: question.tests || [],
    points: question.points,
  };
}

export function generationMessages({ objective, seed }) {
  return [
    {
      role: 'system',
      content: 'You write one original exam variant for a junior developer milestone. Return JSON only. Keep the same skill and difficulty. Change names, numbers, and wording. The correct answer must be true. Do not copy the seed prompt.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        objective,
        seed: seedView(seed),
        shape: seed.type === 'mcq'
          ? { type: 'mcq', prompt: 'string', options: ['four distinct strings'], correctAnswer: 'one of the options', points: seed.points || 10 }
          : seed.type === 'code'
            ? { type: 'code', prompt: 'string', tests: [{ name: 'string', input: 'stdin', output: 'stdout' }], solution: 'javascript that reads stdin and prints the expected stdout', points: seed.points || 30 }
            : { type: 'written', prompt: 'string', rubric: 'shared scoring criteria, at least 40 characters', points: seed.points || 20 },
      }),
    },
  ];
}

export function verificationMessages({ objective, draft }) {
  return [
    {
      role: 'system',
      content: draft.type === 'written'
        ? 'Decide if this written prompt matches the objective and the rubric can score partial answers consistently. Return JSON {"matchesObjective":true,"rubricUsable":true,"reason":""}. Reject vague prompts.'
        : 'Decide if the keyed option is the only correct answer. Return JSON {"correct":true,"reason":""}. Reject the item when the key is wrong or more than one option is correct.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        objective,
        prompt: draft.prompt,
        options: draft.options || [],
        correctAnswer: draft.correctAnswer || '',
        rubric: draft.rubric || '',
      }),
    },
  ];
}

export function normalizeDraft(draft, id) {
  if (!draft || typeof draft !== 'object') return null;
  if (draft.type === 'mcq') return normalizeMcq({ ...draft, id });
  if (draft.type === 'code') return normalizeCode({ ...draft, id });
  if (draft.type === 'written') return normalizeWritten({ ...draft, id });
  return null;
}

async function testsPass(solution, tests, runCode) {
  const result = await runCode(solution, tests);
  const cases = result?.tests || [];
  return cases.length > 0 && cases.every(item => item.passed);
}

export async function authorVariant({ objective, seed, complete, runCode, id }) {
  const draft = await complete(generationMessages({ objective, seed }));
  const questionId = slugId(id || `gen-${seed.id}-${Date.now()}`, 70);
  const question = normalizeDraft({ ...draft, type: seed.type, points: seed.points }, questionId);
  if (!question) return { ok: false, reason: 'The generated question did not match the exam schema.' };
  if (question.prompt.trim() === String(seed.prompt || '').trim()) return { ok: false, reason: 'The variant copied the original prompt.' };

  if (question.type === 'code') {
    const solution = String(draft.solution || '').trim();
    if (solution.length < 8) return { ok: false, reason: 'The code variant did not include a reference solution.' };
    const passed = await testsPass(solution, question.tests, runCode);
    if (!passed) return { ok: false, reason: 'The reference solution failed its own tests.' };
    return { ok: true, question, check: 'sandbox' };
  }

  const verdict = await complete(verificationMessages({ objective, draft: question }));
  if (question.type === 'mcq' && verdict?.correct !== true) {
    return { ok: false, reason: verdict?.reason || 'The verifier rejected the keyed answer.' };
  }
  if (question.type === 'written' && (question.rubric.length < 40 || verdict?.matchesObjective !== true || verdict?.rubricUsable !== true)) {
    return { ok: false, reason: verdict?.reason || 'The written prompt or rubric is not usable.' };
  }
  return { ok: true, question, check: 'model' };
}
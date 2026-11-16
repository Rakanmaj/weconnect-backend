import { runJavaScript } from './growth-grading.js';
import { getConfig } from './config.js';

export const MILESTONE_UNLOCK = 60;

export function applyPaper(attempt) {
  if (Array.isArray(attempt?.paper_questions) && attempt.paper_questions.length) {
    attempt.questions = attempt.paper_questions;
  }
  if (attempt?.kind === 'challenge') attempt.pass_score = MILESTONE_UNLOCK;
  return attempt;
}

function words(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || [])];
}

function writtenPercent(question, answer) {
  const text = String(answer || '').trim();
  if (text.length < 8) return 0;
  const reference = words(`${question.prompt} ${question.rubric}`);
  const used = words(text);
  if (!used.length) return 15;
  const hits = used.filter(word => reference.includes(word)).length;
  const overlap = hits / Math.min(Math.max(used.length, 1), 10);
  return Math.round(Math.min(92, 28 + overlap * 60 + Math.min(text.length, 400) / 40));
}

async function codePercent(question, answer, config) {
  const text = String(answer || '').trim();
  if (text.length < 8) return 0;
  if (!question.tests?.length) return Math.min(70, 25 + Math.round(text.length / 20));
  const result = await runJavaScript(text, question.tests, config || getConfig());
  const tests = result.tests || [];
  if (!tests.length) return text.length > 30 ? 35 : 15;
  const passed = tests.filter(test => test.passed).length;
  return Math.round((passed / tests.length) * 100);
}

function questionNote(question, answer, percent) {
  const text = String(answer || '').trim();
  if (question.type === 'mcq') {
    if (percent === 100) return `Your answer “${text}” is correct.`;
    if (!text) return `You left this blank. The answer is “${question.correctAnswer}”.`;
    return `Your answer “${text}” is not correct. The answer is “${question.correctAnswer}”.`;
  }
  if (!text) return 'You left this blank, so it earned no points.';
  if (question.type === 'code') {
    if (percent === 100) return 'Your code passed the tests.';
    if (percent === 0) return 'Your code did not pass the tests.';
    return `Your code passed some of the tests and earned ${percent}% of this question.`;
  }
  if (percent === 0) return 'This written answer did not earn points.';
  if (percent >= 100) return 'This written answer earned full points.';
  return `This written answer earned ${percent}% of this question.`;
}

export function subjectiveQuestion(question) {
  if (!question || question.type === 'mcq') return false;
  if (question.type === 'written') return true;
  return question.type === 'code' && !question.tests?.length;
}

export function executableCodeQuestion(question) {
  return question?.type === 'code' && question.tests?.length > 0;
}

export async function gradeMilestone(questions, answers, config) {
  let earned = 0;
  let total = 0;
  const notes = [];
  const questionResults = [];
  for (const question of questions) {
    total += question.points;
    const answer = answers[question.id] || '';
    let percent = 0;
    if (question.type === 'mcq') percent = answer === question.correctAnswer ? 100 : 0;
    else if (executableCodeQuestion(question)) percent = await codePercent(question, answer, config);
    else percent = writtenPercent(question, answer);
    const points = Math.round(question.points * percent) / 100;
    earned += points;
    questionResults.push({ id: question.id, earned: points, points: question.points, percent, note: questionNote(question, answer, percent) });
    if (percent > 0 && percent < 100) notes.push(`${question.id}: partial credit ${percent}%`);
    if (percent === 0) notes.push(`${question.id}: no credit yet`);
  }
  let usedModel = false;
  const subjective = questions.filter(subjectiveQuestion);
  const model = subjective.length ? await modelGrade(subjective, answers) : null;
  if (model?.questions?.length) {
    const byId = Object.fromEntries(model.questions.map(item => [item.id, item]));
    for (const result of questionResults) {
      const question = questions.find(item => item.id === result.id);
      if (!subjectiveQuestion(question)) continue;
      const graded = byId[result.id];
      if (!graded || !Number.isFinite(graded.percent)) continue;
      const answer = answers[result.id] || '';
      const percent = Math.max(0, Math.min(100, Math.round(graded.percent)));
      result.percent = percent;
      result.earned = Math.round(question.points * percent) / 100;
      result.note = graded.note || questionNote(question, answer, percent);
      usedModel = true;
    }
    earned = questionResults.reduce((sum, item) => sum + item.earned, 0);
  }
  const score = total ? Math.round(earned * 10000 / total) / 100 : 0;
  const unlocked = score >= MILESTONE_UNLOCK;
  const feedback = model?.feedback || (unlocked
    ? `You reached ${score}%. ${MILESTONE_UNLOCK}% unlocks the next milestone on this skill path.`
    : `You scored ${score}%. ${MILESTONE_UNLOCK}% unlocks the next milestone. Start this milestone again for a different set of questions. The coach keeps what you already tried.`);
  return { score, unlocked, feedback, notes, questionResults, source: usedModel ? 'model' : 'rules' };
}

const CRITERIA = `You grade junior developer exam answers. Use one consistent rubric for every student on subjective items (written answers and pseudocode-style code with no runtime tests).

Rubric weights (for written and pseudocode only): correctness and coverage 50%, edge cases and completeness 25%, clarity 25%. Partial credit is allowed.

There is no single correct wording for written or pseudocode answers. Compare each answer to the prompt and rubric only. Do not require exact phrases from a reference unless they reflect a truly required fact.

For items with gradingMode "executable", ignore this message — those are not in your batch.

Return JSON only: {"score":0-100,"feedback":"short summary","questions":[{"id":"","percent":0-100,"note":"one sentence citing this student's answer"}]}.
Include every question id from the batch. percent is credit for that question (0-100, not points).`;

async function modelGrade(questions, answers) {
  if (!process.env.GROQ_API_KEY || process.env.NODE_TEST_CONTEXT) return null;
  try {
    const { groqJson } = await import('./ai/groq.js');
    const payload = questions.map(question => ({
      id: question.id,
      type: question.type,
      gradingMode: question.type === 'written' ? 'written' : 'pseudocode',
      points: question.points,
      prompt: question.prompt,
      rubric: question.rubric,
      referenceAnswer: question.correctAnswer || question.rubric || '',
      answer: answers[question.id] || '',
    }));
    const result = await groqJson({
      temperature: 0,
      messages: [
        { role: 'system', content: CRITERIA },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    });
    const score = Number(result.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    const graded = Array.isArray(result.questions)
      ? result.questions
        .filter(item => item?.id)
        .map(item => ({
          id: String(item.id),
          percent: Math.max(0, Math.min(100, Number(item.percent))),
          note: String(item.note || '').slice(0, 500),
        }))
        .filter(item => Number.isFinite(item.percent) && item.note)
      : [];
    if (!graded.length) return null;
    return { score: Math.round(score * 100) / 100, feedback: String(result.feedback || '').slice(0, 2000), questions: graded };
  } catch {
    return null;
  }
}

export function coachFromHistory({ title, history }) {
  const hints = [
    `Work through ${title}. ${MILESTONE_UNLOCK}% on this try unlocks the next milestone.`,
  ];
  const previous = history[0];
  if (!previous) {
    hints.push('Explain the idea in your own words. A partly correct answer still earns credit.');
    return { hints, source: 'rules' };
  }
  hints.push(`Last try on this skill scored ${previous.score}%. Use that attempt as a starting point, not a script to copy.`);
  if (previous.excerpt) {
    hints.push(`You previously wrote: “${previous.excerpt}”. Check the same weak spot on this new question before you submit.`);
  }
  hints.push(previous.score < MILESTONE_UNLOCK
    ? 'This try is a different set of questions on the same milestone. Aim for the part you missed last time.'
    : 'You already passed an earlier milestone. Keep the same habit: state the rule, then apply it.');
  return { hints, source: 'history' };
}

export async function maybePersonalizeCoach(coach, config) {
  const key = process.env.GROQ_API_KEY;
  if (!key || process.env.NODE_TEST_CONTEXT || !coach.hints.length) return coach;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: process.env.GROQ_COACH_MODEL || 'openai/gpt-oss-20b',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You coach a junior developer during a skill milestone. Return JSON {"hints":["...","...","..."]} with 2 or 3 short hints. Do not reveal the correct option or a full solution. Use their earlier answer if provided.' },
          { role: 'user', content: coach.hints.join('\n') },
        ],
      }),
    });
    if (!response.ok) return coach;
    const body = await response.json();
    const text = body.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!Array.isArray(parsed.hints) || !parsed.hints.length) return coach;
    return { hints: parsed.hints.map(hint => String(hint).slice(0, 400)).slice(0, 3), source: 'groq' };
  } catch {
    return coach;
  }
}

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function questionsByType(questions) {
  const groups = { mcq: [], code: [], written: [] };
  for (const question of questions || []) {
    if (!question?.id || !groups[question.type]) continue;
    groups[question.type].push(question);
  }
  return groups;
}

function pickQuestions(pool, count, usedIds, lastIds) {
  if (!count) return [];
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const last = lastIds instanceof Set ? lastIds : new Set(lastIds);
  const candidates = shuffle(pool.filter(question => question?.id && !used.has(question.id)));
  const fresh = candidates.filter(question => !last.has(question.id));
  const source = fresh.length >= count ? fresh : candidates;
  const picked = source.slice(0, count);
  for (const question of picked) used.add(question.id);
  return picked;
}

export async function choosePlacementPaper(client, { userId, activityId, careerPath, fallbackQuestions }) {
  const previous = await client.query(
    `SELECT paper_questions FROM growth_attempts WHERE user_id=$1 AND activity_id=$2 AND paper_questions IS NOT NULL ORDER BY started_at`,
    [userId, activityId],
  );
  const used = new Set();
  let lastIds = [];
  for (const row of previous.rows) {
    lastIds = (row.paper_questions || []).map(question => question?.id).filter(Boolean);
    for (const id of lastIds) used.add(id);
  }

  const { rows } = await client.query(
    `SELECT ei.question FROM exam_items ei
     LEFT JOIN growth_skills s ON s.id = ei.skill_id
     WHERE ei.status = 'approved'
       AND (s.id IS NULL OR $1 = ANY(s.career_paths))
     ORDER BY ei.created_at`,
    [careerPath],
  );
  const bank = questionsByType(rows.map(row => row.question).filter(question => question?.id));
  const fallback = questionsByType(fallbackQuestions);
  const targets = {
    mcq: Math.max(fallback.mcq.length, 1),
    code: Math.max(fallback.code.length, 0),
    written: Math.max(fallback.written.length, 0),
  };

  const paper = [];
  for (const type of ['mcq', 'code', 'written']) {
    const need = targets[type];
    if (!need) continue;
    const primary = bank[type].length ? bank[type] : fallback[type];
    const secondary = bank[type].length ? fallback[type] : [];
    const combined = [...primary];
    for (const question of secondary) {
      if (!combined.some(item => item.id === question.id)) combined.push(question);
    }
    const picked = pickQuestions(combined, need, used, lastIds);
    paper.push(...picked);
    if (picked.length < need) {
      const reserve = fallback[type].filter(question => !picked.some(item => item.id === question.id));
      paper.push(...pickQuestions(reserve, need - picked.length, used, lastIds));
    }
  }

  if (!paper.length) return fallbackQuestions;
  const fallbackIds = new Set((fallbackQuestions || []).map(question => question.id));
  if (paper.length < (fallbackQuestions || []).length) {
    for (const question of fallbackQuestions || []) {
      if (paper.length >= fallbackQuestions.length) break;
      if (paper.some(item => item.id === question.id)) continue;
      if (fallbackIds.has(question.id) && !used.has(question.id)) paper.push(question);
    }
  }
  return paper.sort((a, b) => {
    const order = { mcq: 0, code: 1, written: 2 };
    return (order[a.type] ?? 9) - (order[b.type] ?? 9);
  });
}

export const PAPER_SIZE = 10;

export function selectChallengePaper(pool, usedIds = [], previousIds = []) {
  const questions = (pool || []).filter(question => question?.id);
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const previous = new Set(previousIds);
  const picked = [];
  const seen = new Set();
  const sources = [questions.filter(question => !used.has(question.id)), questions.filter(question => !previous.has(question.id)), questions];
  for (const source of sources) {
    for (const question of source) {
      if (seen.has(question.id)) continue;
      picked.push(question);
      seen.add(question.id);
      if (picked.length === PAPER_SIZE) return picked;
    }
  }
  return picked;
}

export async function choosePaper(client, { userId, activityId, skillId, fallbackQuestions }) {
  const previous = await client.query(
    `SELECT paper_questions FROM growth_attempts WHERE user_id=$1 AND activity_id=$2 AND paper_questions IS NOT NULL ORDER BY started_at`,
    [userId, activityId],
  );
  const used = new Set();
  let lastIds = [];
  for (const row of previous.rows) {
    lastIds = (row.paper_questions || []).map(question => question?.id).filter(Boolean);
    for (const id of lastIds) used.add(id);
  }
  const bank = skillId
    ? await client.query(
      `SELECT activity_id, question FROM exam_items
       WHERE status='approved' AND (skill_id=$1 OR activity_id=$2)
       ORDER BY created_at`,
      [skillId, activityId],
    )
    : { rows: [] };
  const bankQuestions = bank.rows.map(row => ({ ...row, question: row.question })).filter(row => row.question?.id && !used.has(row.question.id));
  const ordered = [
    ...bankQuestions.filter(row => String(row.activity_id) === String(activityId)).map(row => row.question),
    ...(fallbackQuestions || []),
    ...bankQuestions.filter(row => String(row.activity_id) !== String(activityId)).map(row => row.question),
  ];
  const pool = [];
  const seen = new Set();
  for (const question of ordered) {
    if (!question?.id || seen.has(question.id)) continue;
    seen.add(question.id);
    pool.push(question);
  }
  return selectChallengePaper(pool, used, lastIds);
}

export async function recentConceptHistory(client, userId, skillId) {
  if (!skillId) return [];
  const { rows } = await client.query(
    `SELECT score, answer_excerpt FROM student_concept_events
     WHERE user_id=$1 AND skill_id=$2 ORDER BY created_at DESC LIMIT 3`,
    [userId, skillId],
  );
  return rows.map(row => ({ score: Number(row.score), excerpt: String(row.answer_excerpt || '').slice(0, 180) }));
}

export async function rememberConcept(client, attempt, answers, score) {
  const first = attempt.questions[0];
  if (!first) return;
  const excerpt = String(answers[first.id] || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  await client.query(
    `INSERT INTO student_concept_events(user_id,skill_id,activity_id,attempt_id,question_id,score,answer_excerpt,note)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [attempt.user_id, attempt.skill_id, attempt.activity_id, attempt.id, first.id, score, excerpt, attempt.feedback || ''],
  );
}

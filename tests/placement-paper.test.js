import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDatabase } from './helpers/database.js';
import { growthCatalogSql, refreshChallengeLessonsSql } from '../src/growth-catalog.js';
import { choosePlacementPaper } from '../src/milestones.js';

const fallback = [
  { id: 'mcq-a', type: 'mcq', prompt: 'A', options: ['1', '2'], correctAnswer: '1', points: 10 },
  { id: 'mcq-b', type: 'mcq', prompt: 'B', options: ['1', '2'], correctAnswer: '2', points: 10 },
  { id: 'code-1', type: 'code', prompt: 'Code', points: 30, tests: [], options: [], correctAnswer: '', starterCode: '', rubric: '' },
  { id: 'written-1', type: 'written', prompt: 'Write', points: 20, options: [], correctAnswer: '', starterCode: '', rubric: 'Rubric text long enough here.' },
];

let fixture;
before(async () => {
  fixture = await testDatabase();
  await fixture.db.exec(await readFile(new URL('../database/003_developer_growth.sql', import.meta.url), 'utf8'));
  await fixture.db.exec(growthCatalogSql());
  await fixture.db.exec(refreshChallengeLessonsSql());
  await fixture.db.exec(await readFile(new URL('../database/006_exam_bank.sql', import.meta.url), 'utf8'));
  const js = (await fixture.pool.query("SELECT id FROM growth_skills WHERE slug='javascript'")).rows[0].id;
  const objective = (await fixture.pool.query(
    `INSERT INTO learning_objectives (code, statement, skill_id) VALUES ('test:pool', 'Pool', $1) RETURNING id`,
    [js],
  )).rows[0].id;
  for (let n = 0; n < 8; n += 1) {
    await fixture.pool.query(
      `INSERT INTO exam_items (objective_id, skill_id, source_id, external_id, question, status)
       VALUES ($1, $2, 'catalog', $3, $4, 'approved')`,
      [
        objective,
        js,
        `test-mcq-${n}`,
        JSON.stringify({ id: `bank-mcq-${n}`, type: 'mcq', prompt: `Bank ${n}`, options: ['x', 'y'], correctAnswer: 'x', points: 10 }),
      ],
    );
  }
});

after(async () => {
  await fixture?.pool.end();
});

test('placement papers prefer the bank and avoid repeating the last attempt MCQs when possible', async () => {
  const userId = '22222222-2222-2222-2222-222222222222';
  const activityId = '33333333-3333-3333-3333-333333333333';
  const client = {
    query: async (sql, params) => {
      if (sql.includes('growth_attempts')) {
        return { rows: [{ paper_questions: [{ id: 'bank-mcq-0', type: 'mcq' }, { id: 'bank-mcq-1', type: 'mcq' }] }] };
      }
      return fixture.pool.query(sql, params);
    },
  };
  const paper = await choosePlacementPaper(client, {
    userId,
    activityId,
    careerPath: 'Full-Stack Developer',
    fallbackQuestions: fallback,
  });
  assert.equal(paper.length, 4);
  assert.equal(paper.filter(q => q.type === 'mcq').length, 2);
  assert.ok(paper.some(q => q.id.startsWith('bank-mcq-')));
  const mcqIds = paper.filter(q => q.type === 'mcq').map(q => q.id);
  assert.ok(!mcqIds.includes('bank-mcq-0'));
  assert.ok(!mcqIds.includes('bank-mcq-1'));
});
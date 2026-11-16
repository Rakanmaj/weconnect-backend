import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorVariant } from '../src/exam-bank/author.js';
import { runJavaScript } from '../src/growth-grading.js';

const seed = {
  id: 'loops',
  type: 'mcq',
  prompt: 'Which loop visits every array element once?',
  options: ['for', 'css', 'sql', 'html'],
  correctAnswer: 'for',
  points: 10,
  rubric: '',
  tests: [],
};

test('a multiple-choice variant is approved only when the verifier agrees', async () => {
  const calls = [];
  const approved = await authorVariant({
    objective: 'JavaScript: for loops',
    seed,
    id: 'gen-loops-1',
    complete: async messages => {
      calls.push(messages[0].content);
      if (messages[0].content.includes('Decide if')) return { correct: true, reason: 'The keyed option is the only loop.' };
      return { type: 'mcq', prompt: 'Which statement repeats until the index reaches the array length?', options: ['for', 'border', 'join', 'commit'], correctAnswer: 'for', points: 10 };
    },
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.check, 'model');
  assert.equal(approved.question.correctAnswer, 'for');
  assert.equal(calls.length, 2);

  const rejected = await authorVariant({
    objective: 'JavaScript: for loops',
    seed,
    id: 'gen-loops-2',
    complete: async messages => messages[0].content.includes('Decide if')
      ? { correct: false, reason: 'Another option is also correct.' }
      : { type: 'mcq', prompt: 'Pick the loop keyword used with an index.', options: ['for', 'padding', 'group', 'route'], correctAnswer: 'for', points: 10 },
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /another option/i);
});

test('a code variant is approved only when its reference solution passes the sandbox', async () => {
  const codeSeed = { id: 'len', type: 'code', prompt: 'Print the input length.', points: 30, options: [], correctAnswer: '', rubric: '', tests: [{ name: 'hi', input: 'hi', output: '2' }] };
  const passed = await authorVariant({
    objective: 'JavaScript: strings',
    seed: codeSeed,
    id: 'gen-len-1',
    complete: async () => ({ type: 'code', prompt: 'Read stdin and print how many characters it contains.', tests: [{ name: 'hi', input: 'hi', output: '2' }], solution: 'const fs=require("node:fs"); console.log(fs.readFileSync(0,"utf8").length);' }),
    runCode: (solution, tests) => runJavaScript(solution, tests, {}),
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.check, 'sandbox');
  assert.equal(passed.question.solution, undefined);

  const failed = await authorVariant({
    objective: 'JavaScript: strings',
    seed: codeSeed,
    id: 'gen-len-2',
    complete: async () => ({ type: 'code', prompt: 'Read stdin and print the character count.', tests: [{ name: 'hi', input: 'hi', output: '2' }], solution: 'console.log(0)' }),
    runCode: (solution, tests) => runJavaScript(solution, tests, {}),
  });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /failed its own tests/);
});
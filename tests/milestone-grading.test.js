import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executableCodeQuestion, subjectiveQuestion } from '../src/milestones.js';

test('executable code uses the sandbox while pseudocode and written use model grading', () => {
  assert.equal(subjectiveQuestion({ type: 'mcq' }), false);
  assert.equal(subjectiveQuestion({ type: 'written' }), true);
  assert.equal(subjectiveQuestion({ type: 'code', tests: [] }), true);
  assert.equal(subjectiveQuestion({ type: 'code', tests: [{ name: 'a' }] }), false);
  assert.equal(executableCodeQuestion({ type: 'code', tests: [{ name: 'a' }] }), true);
  assert.equal(executableCodeQuestion({ type: 'written' }), false);
});
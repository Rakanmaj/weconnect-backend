import { test } from 'node:test';
import assert from 'node:assert/strict';
import { milestoneLines, rankDevelopers } from '../src/marketplace.js';

test('matching keeps the three closest verified developers and explains the score', () => {
  const brief = { career_path: 'Frontend Developer', skills: ['React', 'JavaScript'] };
  const ranked = rankDevelopers(brief, [
    { id: 'a', career_path: 'Backend Developer', skills: ['PostgreSQL'], completions: 0 },
    { id: 'b', career_path: 'Frontend Developer', skills: ['React', 'JavaScript'], completions: 4 },
    { id: 'c', career_path: 'Frontend Developer', skills: ['React'], completions: 1 },
    { id: 'd', career_path: 'Frontend Developer', skills: [], completions: 0 },
  ]);
  assert.deepEqual(ranked.map(item => item.id), ['b', 'c', 'd']);
  assert.ok(ranked[0].reasons.some(reason => /Career path/.test(reason)));
  assert.deepEqual(milestoneLines('Phase one\n\nPhase two'), ['Phase one', 'Phase two']);
});

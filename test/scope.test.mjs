import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestScopeForTask } from '../src/core/scope.mjs';

test('scope suggestion narrows to touched files inside the scope', () => {
  const result = suggestScopeForTask('T-001', ['src', 'test'], [
    'src/auth/login.mjs',
    'src/auth/login.test.mjs',
    'docs/readme.md',
    'src/auth/login.mjs',
    '.trellis/docs/TASKS.md'
  ]);
  assert.deepEqual(result.suggested, ['src/auth/login.mjs', 'src/auth/login.test.mjs']);
  assert.deepEqual(result.outside, ['docs/readme.md']);
  assert.equal(result.touched, 3);
  assert.equal(result.narrows, true);
});

test('nothing inside the scope means no suggestion', () => {
  const result = suggestScopeForTask('T-001', ['src'], ['docs/readme.md']);
  assert.deepEqual(result.suggested, []);
  assert.deepEqual(result.outside, ['docs/readme.md']);
  assert.equal(result.narrows, false);
});

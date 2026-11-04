import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { selectTaskCommits, suggestScopeForTask } from '../src/core/scope.mjs';
import { applyTaskScope } from '../src/core/mutations.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

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


test('scope apply narrows the board and audits it', async () => {
  const dir = await makeProject('generic');
  try {
    await applyTaskScope(dir, 'T-001', ['src/feature.mjs'], { by: 'coordinator:kim' });
    const { tasks } = await parseTasks(dir);
    assert.deepEqual(tasks[0].scope, ['src/feature.mjs']);

    const state = JSON.parse(await readFile(path.join(dir, '.trellis/state.json'), 'utf8'));
    assert.equal(state.audit.at(-1).action, 'task.scope.narrowed');
  } finally {
    await cleanup(dir);
  }
});

test('scope apply refuses to widen the scope', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => applyTaskScope(dir, 'T-001', ['docs/readme.md'], { by: 'coordinator:kim' }),
      (error) => error.code === 'SCOPE_APPLY_WIDENS'
    );
  } finally {
    await cleanup(dir);
  }
});


test('commit selection matches the exact task token, not a prefix', () => {
  const commits = [
    { hash: 'a', body: 'fix T-001 parser' },
    { hash: 'b', body: 'T-0010 is a different task' },
    { hash: 'c', body: 'T-001' },
    { hash: 'd', body: 'see T-001.' }
  ];
  assert.deepEqual(selectTaskCommits(commits, 'T-001').map((commit) => commit.hash), ['a', 'c', 'd']);
});

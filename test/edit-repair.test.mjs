import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { editTask } from '../src/core/mutations.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const secondRow = (scope, dependsOn = '-') =>
  `| T-002 | M0 | Second | executor | ${scope} | ${dependsOn} | b | npm test | todo | medium |\n`;

test('task edit works while the board already has unrelated conflicts', async () => {
  const dir = await makeProject('generic');
  try {
    const board = path.join(dir, '.trellis/docs/TASKS.md');
    await appendFile(board, secondRow('src'));
    const result = await editTask(dir, 'T-001', { acceptance: 'edited while dirty', by: 'architect:ann' });
    assert.deepEqual(result.changed, ['acceptance']);
  } finally {
    await cleanup(dir);
  }
});

test('clearing dependencies is allowed even though it exposes a conflict', async () => {
  const dir = await makeProject('generic');
  try {
    const board = path.join(dir, '.trellis/docs/TASKS.md');
    await appendFile(board, secondRow('src', 'T-002'));
    await editTask(dir, 'T-001', { dependsOn: '', by: 'coordinator:kim' });
    const { tasks } = await parseTasks(dir);
    assert.deepEqual(tasks[0].dependsOn, []);
  } finally {
    await cleanup(dir);
  }
});

test('an edit that introduces a new conflict is still refused', async () => {
  const dir = await makeProject('generic');
  try {
    const board = path.join(dir, '.trellis/docs/TASKS.md');
    await appendFile(board, secondRow('docs/b'));
    await assert.rejects(
      () => editTask(dir, 'T-002', { scope: 'src', by: 'architect:ann' }),
      (error) => error.code === 'TASK_INVALID'
    );
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addTask } from '../src/core/project.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const base = {
  title: 'Fix the login crash reported in testing',
  scope: 'src/auth, test',
  acceptance: 'a regression test covers the crash and passes',
  verification: 'npm test',
  dependsOn: 'T-001',
  by: 'coordinator:kim'
};

test('task add appends a valid row and allocates the next id', async () => {
  const dir = await makeProject('generic');
  try {
    const { task } = await addTask(dir, base);
    assert.equal(task.id, 'T-002');
    assert.equal(task.status, 'todo');
    assert.deepEqual(task.scope, ['src/auth', 'test']);

    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[1].title, base.title);

    const state = JSON.parse(await readFile(path.join(dir, '.trellis', 'state.json'), 'utf8'));
    assert.equal(state.audit.at(-1).action, 'task.added');
    assert.equal(state.audit.at(-1).actor, 'coordinator:kim');
  } finally {
    await cleanup(dir);
  }
});

test('task add refuses an unknown milestone', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => addTask(dir, { ...base, milestone: 'M9' }),
      (error) => error.code === 'TASK_INVALID' && /unknown milestone/.test(error.message)
    );
  } finally {
    await cleanup(dir);
  }
});

test('task add refuses a duplicate id', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => addTask(dir, { ...base, id: 'T-001' }),
      (error) => error.code === 'TASK_ID_DUPLICATE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('task add refuses a table-breaking field', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => addTask(dir, { ...base, title: 'crash | on login' }),
      (error) => error.code === 'USAGE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('task add refuses overlapping scope without a dependency', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => addTask(dir, { ...base, dependsOn: [] }),
      (error) => error.code === 'TASK_INVALID' && /write domain/.test(error.message)
    );
  } finally {
    await cleanup(dir);
  }
});

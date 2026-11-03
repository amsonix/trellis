import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks, validateTasks, updateTaskStatus } from '../src/core/tasks.mjs';
import { cleanup, makeProject, appendTask, replace, read } from './helpers.mjs';

test('parses the starter task row', async () => {
  const dir = await makeProject();
  try {
    const parsed = await parseTasks(dir);
    assert.equal(parsed.error, null);
    assert.equal(parsed.tasks.length, 1);
    assert.equal(parsed.tasks[0].id, 'T-001');
    assert.deepEqual(parsed.tasks[0].scope, ['src', 'test', 'package.json', 'README.md']);
    assert.deepEqual(parsed.tasks[0].dependsOn, []);
  } finally {
    await cleanup(dir);
  }
});

test('two concurrent tasks cannot share a write domain', async () => {
  const dir = await makeProject();
  try {
    await appendTask(
      dir,
      '| T-002 | M0 | Second task | executor | src | - | Build passes | `npm test` | todo |'
    );
    const { tasks } = await parseTasks(dir);
    const checks = validateTasks(tasks, { milestones: [{ id: 'M0' }] });
    assert.ok(checks.some((check) => check.code === 'TASK_SCOPE_OVERLAP'));
  } finally {
    await cleanup(dir);
  }
});

test('a dependency cycle is rejected', async () => {
  const dir = await makeProject();
  try {
    await replace(dir, '.trellis/docs/TASKS.md', '| src, test, package.json, README.md | - |', '| src, test, package.json, README.md | T-002 |');
    await appendTask(
      dir,
      '| T-002 | M0 | Second task | executor | docs | T-001 | Build passes | `npm test` | todo |'
    );
    const { tasks } = await parseTasks(dir);
    const checks = validateTasks(tasks, { milestones: [{ id: 'M0' }] });
    assert.ok(checks.some((check) => check.code === 'TASK_CYCLE'));
  } finally {
    await cleanup(dir);
  }
});

test('a task without acceptance is rejected', async () => {
  const dir = await makeProject();
  try {
    await replace(dir, '.trellis/docs/TASKS.md', '| Build, test, and lint pass |', '|  |');
    const { tasks } = await parseTasks(dir);
    const checks = validateTasks(tasks, { milestones: [{ id: 'M0' }] });
    assert.ok(checks.some((check) => check.code === 'TASK_ACCEPTANCE_EMPTY'));
  } finally {
    await cleanup(dir);
  }
});

test('updateTaskStatus rewrites only the status cell', async () => {
  const dir = await makeProject();
  try {
    const changed = await updateTaskStatus(dir, 'T-001', 'in_progress');
    assert.equal(changed, true);
    const text = await read(dir, '.trellis/docs/TASKS.md');
    assert.match(text, /\| in_progress \|/);
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].status, 'in_progress');
  } finally {
    await cleanup(dir);
  }
});

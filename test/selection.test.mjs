import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { approveGate } from '../src/core/gates.mjs';
import { addTask } from '../src/core/mutations.mjs';
import { nextAction, projectStatus } from '../src/core/project.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function approvePlan(dir) {
  for (const [gate, by] of [
    ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
    ['G3', 'human:alice'], ['G4', 'coordinator:kim']
  ]) await approveGate(dir, gate, { by });
}

test('new tasks carry a Created date and next reports ageDays', async () => {
  const dir = await makeProject('generic');
  try {
    const { tasks } = await parseTasks(dir);
    assert.match(tasks[0].createdAt, /^\d{4}-\d{2}-\d{2}$/);
    await addTask(dir, { title: 'Second', scope: 'docs/b', acceptance: 'b', verification: 'manual', by: 'architect:ann' });
    const parsed = await parseTasks(dir);
    assert.match(parsed.tasks[1].createdAt, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    await cleanup(dir);
  }
});

test('at equal priority the older task is selected first', async () => {
  const dir = await makeProject('generic');
  try {
    const board = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(board, 'utf8');
    await writeFile(board, text.replace(/\| ([0-9]{4}-[0-9]{2}-[0-9]{2}) \|\n/, '| 2020-01-01 |\n'));
    await addTask(dir, { title: 'Second', scope: 'docs/b', acceptance: 'b', verification: 'manual', by: 'architect:ann' });
    await approvePlan(dir);

    const result = await nextAction(dir, 'executor', { batch: 2 });
    assert.equal(result.kind, 'tasks');
    assert.equal(result.tasks[0].id, 'T-001');
    assert.ok(result.tasks[0].ageDays > 1000);
    assert.match(result.tasks[0].why, /age \d+d/);
  } finally {
    await cleanup(dir);
  }
});

test('an invalid priority blocks next instead of being ranked as medium', async () => {
  const dir = await makeProject('generic');
  try {
    const board = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(board, 'utf8');
    await writeFile(board, text.replace('| todo | medium |', '| todo | urgent |'));
    const result = await nextAction(dir, 'executor');
    assert.equal(result.kind, 'waiting');
    assert.ok(result.attention.some((item) => item.code === 'TASK_PRIORITY_INVALID'));
  } finally {
    await cleanup(dir);
  }
});

test('TRELLIS_MAX_OPEN refuses new work; only a human can force it', async () => {
  const dir = await makeProject('generic');
  const previous = process.env.TRELLIS_MAX_OPEN;
  process.env.TRELLIS_MAX_OPEN = '1';
  try {
    await assert.rejects(
      () => addTask(dir, { title: 'Second', scope: 'docs/b', acceptance: 'b', verification: 'manual', by: 'architect:ann' }),
      (error) => error.code === 'TASK_BACKLOG_FULL'
    );
    await assert.rejects(
      () => addTask(dir, { title: 'Forced', scope: 'docs/c', acceptance: 'c', verification: 'manual', force: true, by: 'executor:w1' }),
      (error) => error.code === 'TASK_BACKLOG_FORCE_ROLE'
    );
    const forced = await addTask(dir, {
      title: 'Forced', scope: 'docs/c', acceptance: 'c', verification: 'manual', force: true, by: 'human:alice'
    });
    assert.equal(forced.task.id, 'T-002');
  } finally {
    if (previous === undefined) delete process.env.TRELLIS_MAX_OPEN;
    else process.env.TRELLIS_MAX_OPEN = previous;
    await cleanup(dir);
  }
});

test('status surfaces stale backlog by age', async () => {
  const dir = await makeProject('generic');
  const previous = process.env.TRELLIS_STALE_DAYS;
  process.env.TRELLIS_STALE_DAYS = '1';
  try {
    const board = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(board, 'utf8');
    await writeFile(board, text.replace(/\| ([0-9]{4}-[0-9]{2}-[0-9]{2}) \|\n/, '| 2020-01-01 |\n'));
    const status = await projectStatus(dir);
    const stale = status.attention.find((item) => item.code === 'TASK_BACKLOG_STALE');
    assert.ok(stale);
    assert.equal(stale.oldest, 'T-001');
  } finally {
    if (previous === undefined) delete process.env.TRELLIS_STALE_DAYS;
    else process.env.TRELLIS_STALE_DAYS = previous;
    await cleanup(dir);
  }
});

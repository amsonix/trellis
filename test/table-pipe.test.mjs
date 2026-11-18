import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reportTask } from '../src/core/mutations.mjs';
import { runChecks } from '../src/core/project.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const board = (dir) => path.join(dir, '.trellis/docs/TASKS.md');

test('an escaped pipe stays inside its cell and preserves status/source', async () => {
  const dir = await makeProject('generic');
  try {
    const file = board(dir);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('Build, test, and lint pass', 'acceptance with a \\| pipe'));

    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].acceptance, 'acceptance with a | pipe');
    assert.equal(tasks[0].status, 'todo');
    assert.equal(tasks[0].source, 'ROADMAP#M0/exit-1');
    assert.equal(tasks[0].rowMisaligned, false);

    const reported = await reportTask(dir, 'T-001', { state: 'ready', by: 'coordinator:kim' });
    assert.equal(reported.task.status, 'ready');
  } finally {
    await cleanup(dir);
  }
});

test('a genuinely misaligned row is reported as ROW_MISALIGNED', async () => {
  const dir = await makeProject('generic');
  try {
    const file = board(dir);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('Build, test, and lint pass', 'broken | extra cell'));

    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].rowMisaligned, true);
    const checks = await runChecks(dir);
    assert.ok(checks.checks.some((check) => check.code === 'ROW_MISALIGNED' && check.severity === 'fail'));
  } finally {
    await cleanup(dir);
  }
});

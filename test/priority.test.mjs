import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addTask, editTask } from '../src/core/mutations.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const noPriorityBoard = `# Tasks

## 1. In progress

| ID | Milestone | Title | Role | Scope | Depends on | Acceptance | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-001 | M0 | Bootstrap the project | executor | src | - | Build, test, and lint pass | \`npm test\` and CI | todo |
`;

test('editing priority on a board without the column is refused, not silently lost', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(path.join(dir, '.trellis/docs/TASKS.md'), noPriorityBoard);
    await assert.rejects(
      () => editTask(dir, 'T-001', { priority: 'high', by: 'architect:ann' }),
      (error) => error.code === 'USAGE' && /no 'priority' column/.test(error.message)
    );
    const audit = await readFile(path.join(dir, '.trellis/audit.jsonl'), 'utf8').catch(() => '');
    assert.ok(!audit.includes('task.edited'));
  } finally {
    await cleanup(dir);
  }
});

test('adding a non-default priority on a column-less board is refused', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(path.join(dir, '.trellis/docs/TASKS.md'), noPriorityBoard);
    await assert.rejects(
      () => addTask(dir, {
        title: 'P', scope: 'docs/p', acceptance: 'p', verification: 'manual', priority: 'high', by: 'architect:ann'
      }),
      (error) => error.code === 'USAGE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('editing priority with the column present is stored and read back', async () => {
  const dir = await makeProject('generic');
  try {
    await editTask(dir, 'T-001', { priority: 'high', by: 'architect:ann' });
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].priority, 'high');
  } finally {
    await cleanup(dir);
  }
});

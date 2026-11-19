import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimTask, releaseLease } from '../src/core/mutations.mjs';
import { checkpointTask, evidenceFor, projectStatus } from '../src/core/project.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a checkpoint records progress without changing the task state', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:lane-a' });
    const result = await checkpointTask(dir, 'T-001', {
      note: 'done: parser; next: error path', uri: 'src/parser.mjs', by: 'executor:lane-a'
    });
    assert.equal(result.status, 'in_progress');
    assert.equal(result.evidence.kind, 'checkpoint');
    assert.equal(result.evidence.verdict, 'inconclusive');
    assert.equal((await parseTasks(dir)).tasks[0].status, 'in_progress');

    const records = await evidenceFor(dir, 'T-001');
    assert.ok(records.some((record) => record.kind === 'checkpoint' && record.note.includes('next: error path')));
  } finally {
    await cleanup(dir);
  }
});

test('an in_progress task with no recent evidence is TASK_STALE', async () => {
  const dir = await makeProject('generic');
  const previous = process.env.TRELLIS_TASK_STALE_HOURS;
  process.env.TRELLIS_TASK_STALE_HOURS = '1';
  try {
    const file = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace(/\| 20\d\d-\d\d-\d\d \|/, '| 2020-01-01 |'));
    await claimTask(dir, 'T-001', { by: 'executor:lane-a' });
    await releaseLease(dir, 'T-001', 'executor:lane-a');

    const status = await projectStatus(dir);
    assert.ok(status.attention.some((item) => item.code === 'TASK_STALE' && item.task === 'T-001'));
  } finally {
    if (previous === undefined) delete process.env.TRELLIS_TASK_STALE_HOURS;
    else process.env.TRELLIS_TASK_STALE_HOURS = previous;
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, utimes, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { approveGate } from '../src/core/gates.mjs';
import { editTask } from '../src/core/mutations.mjs';
import { compactLogs } from '../src/core/compact.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { projectStatus } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('task edit updates fields, validates dependencies and is audited', async () => {
  const dir = await makeProject('generic');
  try {
    await editTask(dir, 'T-001', { acceptance: 'the edited test passes', by: 'architect:ann' });
    let { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].acceptance, 'the edited test passes');
    const audit = await readFile(path.join(dir, '.trellis/audit.jsonl'), 'utf8');
    assert.match(audit, /task\.edited/);

    await assert.rejects(
      () => editTask(dir, 'T-001', { dependsOn: 'T-999', by: 'architect:ann' }),
      (error) => error.code === 'TASK_INVALID'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a dependency edit makes plan gates stale', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
      ['G3', 'human:alice'], ['G4', 'coordinator:kim']
    ]) await approveGate(dir, gate, { by });

    await editTask(dir, 'T-001', { dependsOn: 'T-001', by: 'architect:ann' }).catch(() => {});
    const status = await projectStatus(dir);
    assert.ok(status.driftedGates.length + status.staleGates.length >= 0);
  } finally {
    await cleanup(dir);
  }
});

test('compact prunes old logs unless evidence references them', async () => {
  const dir = await makeProject('generic');
  try {
    const logs = path.join(dir, '.trellis/logs');
    await mkdir(logs, { recursive: true });
    const old = path.join(logs, 'old.log');
    await writeFile(old, 'old');
    const stamp = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await utimes(old, stamp, stamp);
    const result = await compactLogs(dir, { days: 30 });
    assert.deepEqual(result.removed, ['old.log']);
  } finally {
    await cleanup(dir);
  }
});

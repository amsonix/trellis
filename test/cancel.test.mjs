import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { approveGate } from '../src/core/gates.mjs';
import { addTask } from '../src/core/project.mjs';
import { claimTask, cancelTask, reportTask } from '../src/core/mutations.mjs';
import { leaseStatus } from '../src/core/lease.mjs';
import { readyTasks } from '../src/core/tasks.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { exportA2A } from '../src/core/export-a2a.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a human can cancel work and the audit records it', async () => {
  const dir = await makeProject('generic');
  try {
    const data = await cancelTask(dir, 'T-001', { by: 'human:alice', reason: 'no longer needed' });
    assert.equal(data.task.status, 'canceled');
    const state = JSON.parse(await readFile(path.join(dir, '.trellis/state.json'), 'utf8'));
    assert.equal(state.audit.at(-1).action, 'task.canceled');
    assert.equal(state.audit.at(-1).detail.reason, 'no longer needed');
  } finally {
    await cleanup(dir);
  }
});

test('cancel releases the lease and is terminal', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await cancelTask(dir, 'T-001', { by: 'coordinator:kim', reason: 'dropped' });
    assert.equal((await leaseStatus(dir)).length, 0);

    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w1' }),
      (error) => error.code === 'TASK_NOT_CLAIMABLE'
    );
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' }),
      (error) => error.code === 'TASK_TRANSITION'
    );
  } finally {
    await cleanup(dir);
  }
});

test('only a human or coordinator cancels, and the reason is required', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => cancelTask(dir, 'T-001', { by: 'executor:w1', reason: 'x' }),
      (error) => error.code === 'TASK_CANCEL_ROLE'
    );
    await assert.rejects(
      () => cancelTask(dir, 'T-001', { by: 'human:alice', reason: '' }),
      /reason/
    );
  } finally {
    await cleanup(dir);
  }
});

test('canceled tasks do not satisfy dependencies', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'After', scope: 'docs/after', acceptance: 'a', verification: 'v', dependsOn: ['T-001'], by: 'coordinator:kim'
    });
    await cancelTask(dir, 'T-001', { by: 'human:alice', reason: 'dropped' });
    const { tasks } = await parseTasks(dir);
    assert.deepEqual(readyTasks(tasks, 'executor').map((task) => task.id), []);
    await assert.rejects(
      () => claimTask(dir, 'T-002', { by: 'executor:w1' }),
      (error) => error.code === 'TASK_BLOCKED_BY_DEPENDENCY'
    );
  } finally {
    await cleanup(dir);
  }
});

test('A2A maps canceled and G6 lists it as a warning', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
      ['G3', 'human:alice'], ['G4', 'coordinator:kim']
    ]) {
      await approveGate(dir, gate, { by });
    }
    await cancelTask(dir, 'T-001', { by: 'human:alice', reason: 'dropped' });

    const exported = await exportA2A(dir);
    assert.equal(exported.tasks[0].status.state, 'canceled');

    const g6 = await approveGate(dir, 'G6', { by: 'verifier:vic' });
    assert.ok(g6.checks.some((check) => check.code === 'TASK_CANCELED' && check.severity === 'warn'));
  } finally {
    await cleanup(dir);
  }
});

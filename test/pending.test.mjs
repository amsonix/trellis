import test from 'node:test';
import assert from 'node:assert/strict';
import { addEvidence, claimTask, reportTask } from '../src/core/mutations.mjs';
import { decideTask, projectStatus, taskShow } from '../src/core/project.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('pending requires a reason and releases the lease', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'pending', by: 'executor:w1' }),
      (error) => error.code === 'USAGE'
    );

    await reportTask(dir, 'T-001', {
      state: 'pending', reason: 'need a decision on the API shape', by: 'executor:w1'
    });
    const tasks = (await parseTasks(dir)).tasks;
    assert.equal(tasks[0].status, 'pending');
    const status = await projectStatus(dir);
    assert.equal(status.leases.length, 0);
    assert.ok(status.attention.some((item) => item.code === 'TASK_PENDING'));

    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w2' }),
      (error) => error.code === 'TASK_PENDING_DECISION'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a human can accept a pending task only with passing evidence', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'pending', reason: 'ready for acceptance', by: 'executor:w1' });

    await assert.rejects(
      () => decideTask(dir, 'T-001', { decision: 'accept', by: 'human:alice' }),
      (error) => error.code === 'EVIDENCE_REQUIRED'
    );

    await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1'
    });
    const decided = await decideTask(dir, 'T-001', {
      decision: 'accept', note: 'looks good', by: 'human:alice'
    });
    assert.equal(decided.task.status, 'done');
    const shown = await taskShow(dir, 'T-001');
    assert.equal(shown.pending.decision, 'accept');
    assert.equal(shown.pending.decidedBy, 'human:alice');
  } finally {
    await cleanup(dir);
  }
});

test('rework returns a pending task to ready and cancel closes it', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'pending', reason: 'needs rework', by: 'executor:w1' });
    const rework = await decideTask(dir, 'T-001', { decision: 'rework', by: 'human:alice' });
    assert.equal(rework.task.status, 'ready');

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'pending', reason: 'obsolete', by: 'executor:w1' });
    const canceled = await decideTask(dir, 'T-001', { decision: 'cancel', by: 'human:alice' });
    assert.equal(canceled.task.status, 'canceled');
  } finally {
    await cleanup(dir);
  }
});

test('review and blocked are legacy and cannot be entered', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    for (const state of ['review', 'blocked']) {
      await assert.rejects(
        () => reportTask(dir, 'T-001', { state, by: 'executor:w1' }),
        (error) => error.code === 'TASK_STATE_LEGACY'
      );
    }
  } finally {
    await cleanup(dir);
  }
});

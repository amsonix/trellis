import test from 'node:test';
import assert from 'node:assert/strict';
import { addEvidence, listEvidence } from '../src/core/evidence.mjs';
import { claimTask, reportTask } from '../src/core/mutations.mjs';
import { leaseStatus } from '../src/core/lease.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a blocked task can return to todo or ready', async () => {
  const dir = await makeProject('generic');
  try {
    await reportTask(dir, 'T-001', { state: 'blocked', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'todo', by: 'coordinator:kim' });
    assert.equal((await parseTasks(dir)).tasks[0].status, 'todo');

    await reportTask(dir, 'T-001', { state: 'blocked', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'ready', by: 'coordinator:kim' });
    assert.equal((await parseTasks(dir)).tasks[0].status, 'ready');
  } finally {
    await cleanup(dir);
  }
});

test('report --dry-run validates without writing or releasing the lease', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });

    const preview = await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1', dryRun: true });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.task.status, 'done');
    assert.equal((await parseTasks(dir)).tasks[0].status, 'in_progress');
    assert.equal((await leaseStatus(dir)).length, 1);

    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    assert.equal((await parseTasks(dir)).tasks[0].status, 'done');
    assert.equal((await leaseStatus(dir)).length, 0);
  } finally {
    await cleanup(dir);
  }
});

test('a superseding passing record retracts the stale fail and unblocks done', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const failed = await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'fail', by: 'executor:w1'
    });
    const passing = await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'reviewer:p', supersedes: failed.id
    });
    assert.deepEqual(passing.superseded, [failed.id]);

    const items = await listEvidence(dir, 'T-001');
    assert.equal(items.find((item) => item.id === failed.id).retracted.reason, `superseded by ${passing.id}`);
    assert.ok(!items.find((item) => item.id === passing.id).retracted);

    const done = await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    assert.equal(done.task.status, 'done');
  } finally {
    await cleanup(dir);
  }
});

test('superseding requires a retractor role and a known id', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const failed = await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'fail', by: 'executor:w1'
    });
    await assert.rejects(
      () => addEvidence(dir, {
        taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1', supersedes: failed.id
      }),
      (error) => error.code === 'EVIDENCE_SUPERSEDE_ROLE'
    );
    await assert.rejects(
      () => addEvidence(dir, {
        taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'reviewer:p', supersedes: 'EV-nope'
      }),
      (error) => error.code === 'EVIDENCE_UNKNOWN'
    );
  } finally {
    await cleanup(dir);
  }
});

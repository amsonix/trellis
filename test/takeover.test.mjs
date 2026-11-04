import test from 'node:test';
import assert from 'node:assert/strict';
import { claimTask, releaseLease } from '../src/core/mutations.mjs';
import { leaseStatus } from '../src/core/lease.mjs';
import { parseTasks, updateTaskStatus } from '../src/core/tasks.mjs';
import { addTask, recoverTask, reportTask } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function orphanClaim(dir) {
  await claimTask(dir, 'T-001', { by: 'executor:w1' });
  await releaseLease(dir, 'T-001', 'coordinator:kim');
}

test('an in_progress task with no lease can be taken over', async () => {
  const dir = await makeProject('generic');
  try {
    await orphanClaim(dir);
    const data = await claimTask(dir, 'T-001', { by: 'executor:w2' });
    assert.equal(data.takenOver, true);
    assert.equal(data.task.status, 'in_progress');
    assert.equal((await leaseStatus(dir)).length, 1);

    const state = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(`${dir}/.trellis/state.json`, 'utf8')));
    assert.equal(state.audit.at(-1).action, 'task.taken_over');
  } finally {
    await cleanup(dir);
  }
});

test('a live lease still makes the claim idempotent, not a takeover', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const data = await claimTask(dir, 'T-001', { by: 'executor:w2' });
    assert.equal(data.idempotent, true);
    assert.equal(data.takenOver, undefined);
  } finally {
    await cleanup(dir);
  }
});

test('takeover still checks dependencies', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'Dependent', scope: 'docs/dep', acceptance: 'a', verification: 'v', dependsOn: ['T-001'], by: 'coordinator:kim'
    });
    await updateTaskStatus(dir, 'T-002', 'in_progress');
    await assert.rejects(
      () => claimTask(dir, 'T-002', { by: 'executor:w2' }),
      (error) => error.code === 'TASK_BLOCKED_BY_DEPENDENCY'
    );
  } finally {
    await cleanup(dir);
  }
});

test('takeover still checks the role', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'Review task', role: 'reviewer', scope: 'docs/role', acceptance: 'a', verification: 'v', by: 'coordinator:kim'
    });
    await updateTaskStatus(dir, 'T-002', 'in_progress');
    await assert.rejects(
      () => claimTask(dir, 'T-002', { by: 'executor:w2' }),
      (error) => error.code === 'TASK_ROLE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('TRELLIS_NO_TAKEOVER=1 refuses and leaves no lease', async () => {
  const dir = await makeProject('generic');
  const previous = process.env.TRELLIS_NO_TAKEOVER;
  try {
    await orphanClaim(dir);
    process.env.TRELLIS_NO_TAKEOVER = '1';
    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w2' }),
      (error) => error.code === 'TASK_STALE_TAKEOVER_REFUSED'
    );
    assert.equal((await leaseStatus(dir)).length, 0);
  } finally {
    if (previous === undefined) delete process.env.TRELLIS_NO_TAKEOVER;
    else process.env.TRELLIS_NO_TAKEOVER = previous;
    await cleanup(dir);
  }
});

test('reporting an orphaned claim back to ready is still refused', async () => {
  const dir = await makeProject('generic');
  try {
    await orphanClaim(dir);
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'ready', by: 'coordinator:kim' }),
      (error) => error.code === 'TASK_TRANSITION'
    );
  } finally {
    await cleanup(dir);
  }
});


test('recover returns an orphaned in_progress task to ready', async () => {
  const dir = await makeProject('generic');
  try {
    await orphanClaim(dir);
    const data = await recoverTask(dir, 'T-001', { to: 'ready', by: 'human:alice', reason: 'agent crashed' });
    assert.equal(data.task.status, 'ready');
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].status, 'ready');

    const state = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(`${dir}/.trellis/state.json`, 'utf8')));
    assert.equal(state.audit.at(-1).action, 'task.recovered');
  } finally {
    await cleanup(dir);
  }
});

test('recover refuses while a lease is held', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await assert.rejects(
      () => recoverTask(dir, 'T-001', { to: 'ready', by: 'human:alice', reason: 'x' }),
      (error) => error.code === 'TASK_RECOVER_LEASE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('recover needs a human or coordinator', async () => {
  const dir = await makeProject('generic');
  try {
    await orphanClaim(dir);
    await assert.rejects(
      () => recoverTask(dir, 'T-001', { to: 'ready', by: 'executor:w2', reason: 'x' }),
      (error) => error.code === 'TASK_RECOVER_ROLE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('recover only applies to in_progress', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => recoverTask(dir, 'T-001', { to: 'ready', by: 'human:alice', reason: 'x' }),
      (error) => error.code === 'TASK_RECOVER_STATE'
    );
  } finally {
    await cleanup(dir);
  }
});

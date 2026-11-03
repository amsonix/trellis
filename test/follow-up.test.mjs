import test from 'node:test';
import assert from 'node:assert/strict';
import { approveGate } from '../src/core/gates.mjs';
import {
  addTask,
  addTaskEvidence,
  claimTask,
  projectStatus,
  reportTask,
  runChecks
} from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function approvePlanning(dir) {
  for (const [gate, by] of [
    ['G0', 'human:alice'],
    ['G1', 'architect:ann'],
    ['G2', 'architect:ann'],
    ['G3', 'human:alice'],
    ['G4', 'coordinator:kim']
  ]) {
    await approveGate(dir, gate, { by });
  }
}

async function finish(dir, taskId) {
  await claimTask(dir, taskId, { by: 'executor:w1' });
  await addTaskEvidence(dir, { taskId, kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
  await reportTask(dir, taskId, { state: 'done', by: 'executor:w1' });
}

const followUp = (extra = {}) => ({
  title: 'Harden the login timeout',
  scope: 'src/auth',
  acceptance: 'the timeout regression test passes',
  verification: 'npm test',
  followUpOf: 'T-001',
  by: 'executor:w1',
  ...extra
});

test('an execution-time follow-up keeps the plan gates approved', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await claimTask(dir, 'T-001', { by: 'executor:w1' });

    const { task } = await addTask(dir, followUp());
    assert.equal(task.id, 'T-002');
    assert.deepEqual(task.dependsOn, ['T-001']);
    assert.equal(task.milestone, 'M0');

    const status = await projectStatus(dir);
    assert.equal(status.staleGates.length, 0);
    const checks = await runChecks(dir);
    assert.equal(checks.summary.fail, 0);
  } finally {
    await cleanup(dir);
  }
});

test('a follow-up cannot leave the parent scope', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await assert.rejects(
      () => addTask(dir, followUp({ scope: 'docs' })),
      (error) => error.code === 'FOLLOWUP_SCOPE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a follow-up parent must be in progress, review or done', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await assert.rejects(
      () => addTask(dir, followUp()),
      (error) => error.code === 'FOLLOWUP_PARENT_STATE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('fan-out is capped at three follow-ups per task', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    for (const scope of ['src/a', 'src/b', 'src/c']) {
      await addTask(dir, followUp({ scope, title: `follow-up ${scope}` }));
    }
    await assert.rejects(
      () => addTask(dir, followUp({ scope: 'src/d', title: 'one too many' })),
      (error) => error.code === 'FOLLOWUP_FANOUT'
    );
  } finally {
    await cleanup(dir);
  }
});

test('depth is capped at two follow-ups', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await finish(dir, 'T-001');

    await addTask(dir, followUp({ scope: 'src/a' }));
    await finish(dir, 'T-002');

    await addTask(dir, followUp({ scope: 'src/a/b', followUpOf: 'T-002', title: 'second level' }));
    await finish(dir, 'T-003');

    await assert.rejects(
      () =>
        addTask(dir, followUp({ scope: 'src/a/b/c', followUpOf: 'T-003', title: 'third level' })),
      (error) => error.code === 'FOLLOWUP_DEPTH'
    );
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { approveGate, claimTask, reportTask, addTaskEvidence, projectStatus, nextAction } from '../src/core/project.mjs';
import { cleanup, makeProject, appendTask } from './helpers.mjs';

test('G5 cannot be approved before G4', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });

    await assert.rejects(
      () => approveGate(dir, 'G5', { by: 'reviewer:rita', taskId: 'T-001' }),
      (error) => error.code === 'GATE_OUT_OF_ORDER'
    );
  } finally {
    await cleanup(dir);
  }
});

async function approveProjectGates(dir, until = 'G4') {
  const sequence = [
    ['G0', 'human:alice'],
    ['G1', 'architect:alice'],
    ['G2', 'architect:alice'],
    ['G3', 'human:alice'],
    ['G4', 'coordinator:bot']
  ];
  for (const [gate, by] of sequence) {
    await approveGate(dir, gate, { by });
    if (gate === until) break;
  }
}

test('a gate refuses an approver whose role is not allowed', async () => {
  const dir = await makeProject();
  try {
    await assert.rejects(
      () => approveGate(dir, 'G0', { by: 'executor:worker-1' }),
      (error) => error.code === 'GATE_APPROVER'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a gate cannot be approved before its predecessor', async () => {
  const dir = await makeProject();
  try {
    await assert.rejects(
      () => approveGate(dir, 'G1', { by: 'architect:alice' }),
      (error) => error.code === 'GATE_OUT_OF_ORDER'
    );
  } finally {
    await cleanup(dir);
  }
});

test('the whole lifecycle reaches maintained', async () => {
  const dir = await makeProject();
  try {
    await approveProjectGates(dir, 'G4');
    let status = await projectStatus(dir);
    assert.equal(status.stage, 'executing');

    const next = await nextAction(dir, 'executor');
    assert.equal(next.kind, 'tasks');
    assert.equal(next.tasks[0].id, 'T-001');

    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await writeFile(path.join(dir, 'test.log'), 'ok\n');
    await addTaskEvidence(dir, {
      taskId: 'T-001',
      kind: 'test',
      uri: 'test.log',
      verdict: 'pass',
      by: 'verifier:ci'
    });
    await reportTask(dir, 'T-001', { state: 'done' });
    await approveGate(dir, 'G5', { taskId: 'T-001', by: 'reviewer:alice' });
    await approveGate(dir, 'G6', { by: 'verifier:ci' });
    await approveGate(dir, 'G7', { by: 'human:alice' });

    status = await projectStatus(dir);
    assert.equal(status.stage, 'maintained');
    assert.equal(status.gates.G5.status, 'passed');
    assert.equal(status.tasks.done, 1);
  } finally {
    await cleanup(dir);
  }
});

test('G5 is blocked when a task has no evidence', async () => {
  const dir = await makeProject();
  try {
    await approveProjectGates(dir, 'G4');
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await reportTask(dir, 'T-001', { state: 'review' });
    await assert.rejects(
      () => approveGate(dir, 'G5', { taskId: 'T-001', by: 'reviewer:alice' }),
      (error) => error.code === 'GATE_BLOCKED' && error.details.checks.some((check) => check.code === 'EVIDENCE_MISSING')
    );
  } finally {
    await cleanup(dir);
  }
});

test('G6 is blocked until every task has passed G5', async () => {
  const dir = await makeProject();
  try {
    await approveProjectGates(dir, 'G4');
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await writeFile(path.join(dir, 'test.log'), 'ok\n');
    await addTaskEvidence(dir, {
      taskId: 'T-001',
      kind: 'test',
      uri: 'test.log',
      verdict: 'pass',
      by: 'verifier:ci'
    });
    await reportTask(dir, 'T-001', { state: 'done' });
    await assert.rejects(
      () => approveGate(dir, 'G6', { by: 'verifier:ci' }),
      (error) => error.code === 'GATE_BLOCKED' && error.details.checks.some((check) => check.code === 'TASK_REVIEW_MISSING')
    );
  } finally {
    await cleanup(dir);
  }
});

test('G4 is blocked by overlapping write scopes', async () => {
  const dir = await makeProject();
  try {
    await appendTask(
      dir,
      '| T-002 | M0 | Second task | executor | src | - | Build passes | `npm test` | todo |'
    );
    await assert.rejects(
      () => approveProjectGates(dir, 'G4'),
      (error) => error.code === 'GATE_BLOCKED' && error.details.checks.some((check) => check.code === 'TASK_SCOPE_OVERLAP')
    );
  } finally {
    await cleanup(dir);
  }
});

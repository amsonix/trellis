import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { approveGate } from '../src/core/gates.mjs';
import { addTaskEvidence, claimTask, nextAction, reportTask } from '../src/core/project.mjs';
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

test('a pending gate needs the user', async () => {
  const dir = await makeProject('generic');
  try {
    const next = await nextAction(dir);
    assert.equal(next.kind, 'gate');
    assert.equal(next.needsUser, true);
    assert.match(next.reason, /G0/);
  } finally {
    await cleanup(dir);
  }
});

test('a ready task runs without the user', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    const next = await nextAction(dir);
    assert.equal(next.kind, 'tasks');
    assert.equal(next.needsUser, false);
    assert.equal(next.reason, null);
    assert.deepEqual(next.tasks.map((task) => task.id), ['T-001']);
  } finally {
    await cleanup(dir);
  }
});

test('a done task waiting for review needs the user', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });

    const next = await nextAction(dir);
    assert.equal(next.kind, 'gate');
    assert.equal(next.gate.id, 'G5');
    assert.equal(next.needsUser, true);
    assert.match(next.reason, /reviewer/);
  } finally {
    await cleanup(dir);
  }
});

test('a stale gate needs the user', async () => {
  const dir = await makeProject('generic');
  try {
    await approveGate(dir, 'G0', { by: 'human:alice' });
    await appendFile(path.join(dir, '.trellis/PROJECT.md'), '\nchanged after approval\n');

    const next = await nextAction(dir);
    assert.equal(next.kind, 'gate');
    assert.equal(next.needsUser, true);
    assert.match(next.reason, /G0/);
  } finally {
    await cleanup(dir);
  }
});

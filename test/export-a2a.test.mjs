import test from 'node:test';
import assert from 'node:assert/strict';
import { exportA2A, mapTaskState } from '../src/core/export-a2a.mjs';
import { claimTask, reportTask } from '../src/core/mutations.mjs';
import { addEvidence } from '../src/core/evidence.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('Trellis statuses map onto the A2A lifecycle', () => {
  assert.equal(mapTaskState('todo'), 'submitted');
  assert.equal(mapTaskState('ready'), 'submitted');
  assert.equal(mapTaskState('in_progress'), 'working');
  assert.equal(mapTaskState('review'), 'working');
  assert.equal(mapTaskState('blocked'), 'input-required');
  assert.equal(mapTaskState('done'), 'completed');
  assert.equal(mapTaskState('unknown'), 'submitted');
});

test('the export keeps the Trellis fields under metadata', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    let data = await exportA2A(dir);
    assert.equal(data.kind, 'a2a.tasks');
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].status.state, 'working');
    assert.equal(data.tasks[0].metadata.trellis.status, 'in_progress');
    assert.deepEqual(data.tasks[0].metadata.trellis.scope, ['src', 'test', 'package.json', 'README.md']);

    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
    data = await exportA2A(dir);
    assert.equal(data.tasks[0].artifacts.length, 1);
    assert.equal(data.tasks[0].artifacts[0].parts[0].text.includes('pass'), true);

    await reportTask(dir, 'T-001', { state: 'blocked', note: 'waiting for a key', by: 'executor:w1' });
    data = await exportA2A(dir);
    assert.equal(data.tasks[0].status.state, 'input-required');
  } finally {
    await cleanup(dir);
  }
});

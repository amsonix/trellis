import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTaskEvidence,
  claimTask,
  reportTask
} from '../src/core/project.mjs';
import { retractEvidence, verifyTaskEvidence } from '../src/core/evidence.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function failing(dir) {
  await claimTask(dir, 'T-001', { by: 'executor:w1' });
  return addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'fail', by: 'executor:w1' });
}

test('a retracted failure no longer blocks done', async () => {
  const dir = await makeProject('generic');
  try {
    const record = await failing(dir);
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' }),
      (error) => error.code === 'EVIDENCE_REQUIRED'
    );

    await retractEvidence(dir, record.id, { by: 'reviewer:rita', reason: 'the crash is fixed in 1d8336d' });
    assert.equal((await verifyTaskEvidence(dir, 'T-001')).some((check) => check.code === 'EVIDENCE_FAIL'), false);

    await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
    const done = await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    assert.equal(done.task.status, 'done');
  } finally {
    await cleanup(dir);
  }
});

test('the producer role cannot retract its own failure', async () => {
  const dir = await makeProject('generic');
  try {
    const record = await failing(dir);
    await assert.rejects(
      () => retractEvidence(dir, record.id, { by: 'executor:w1', reason: 'trust me' }),
      (error) => error.code === 'EVIDENCE_RETRACT_ROLE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('retraction needs a reason and an existing record', async () => {
  const dir = await makeProject('generic');
  try {
    const record = await failing(dir);
    await assert.rejects(
      () => retractEvidence(dir, record.id, { by: 'reviewer:rita', reason: '   ' }),
      (error) => error.code === 'USAGE'
    );
    await assert.rejects(
      () => retractEvidence(dir, 'EV-nope', { by: 'reviewer:rita', reason: 'gone' }),
      (error) => error.code === 'EVIDENCE_UNKNOWN'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a record cannot be retracted twice', async () => {
  const dir = await makeProject('generic');
  try {
    const record = await failing(dir);
    await retractEvidence(dir, record.id, { by: 'reviewer:rita', reason: 'superseded' });
    await assert.rejects(
      () => retractEvidence(dir, record.id, { by: 'reviewer:rita', reason: 'again' }),
      (error) => error.code === 'EVIDENCE_ALREADY_RETRACTED'
    );
  } finally {
    await cleanup(dir);
  }
});

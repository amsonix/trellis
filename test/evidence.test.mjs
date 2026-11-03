import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimTask, reportTask, addTaskEvidence, verifyTask, evidenceFor } from '../src/core/project.mjs';
import { leaseStatus } from '../src/core/lease.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a task cannot be done without passing evidence', async () => {
  const dir = await makeProject();
  try {
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'done' }),
      (error) => error.code === 'EVIDENCE_REQUIRED'
    );

    await writeFile(path.join(dir, 'failing.log'), 'failed\n');
    await addTaskEvidence(dir, {
      taskId: 'T-001',
      kind: 'test',
      uri: 'failing.log',
      verdict: 'fail',
      by: 'verifier:ci'
    });
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'done' }),
      (error) => error.code === 'EVIDENCE_REQUIRED'
    );
  } finally {
    await cleanup(dir);
  }
});

test('passing evidence completes the task and releases its lease', async () => {
  const dir = await makeProject();
  try {
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await writeFile(path.join(dir, 'passing.log'), 'ok\n');
    const record = await addTaskEvidence(dir, {
      taskId: 'T-001',
      kind: 'test',
      uri: 'passing.log',
      verdict: 'pass',
      by: 'verifier:ci'
    });
    assert.ok(record.sha256);
    const result = await reportTask(dir, 'T-001', { state: 'done' });
    assert.equal(result.task.status, 'done');
    assert.equal((await leaseStatus(dir)).length, 0);
    const verified = await verifyTask(dir, 'T-001');
    assert.equal(verified.exitCode, 0);
    assert.equal((await evidenceFor(dir, 'T-001')).length, 1);
  } finally {
    await cleanup(dir);
  }
});

test('inconclusive evidence is not a pass', async () => {
  const dir = await makeProject();
  try {
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await addTaskEvidence(dir, {
      taskId: 'T-001',
      kind: 'benchmark',
      uri: 'https://ci.example/1',
      verdict: 'inconclusive',
      by: 'verifier:ci'
    });
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'done' }),
      (error) => error.code === 'EVIDENCE_REQUIRED'
    );
  } finally {
    await cleanup(dir);
  }
});

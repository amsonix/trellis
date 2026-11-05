import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addEvidence } from '../src/core/evidence.mjs';
import { claimTask, reportTask } from '../src/core/mutations.mjs';
import { nextAction } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a human or coordinator can reopen a done task, with a reason', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });

    const reopened = await reportTask(dir, 'T-001', {
      state: 'in_progress', by: 'coordinator:kim', note: 'the cited anchors were wrong'
    });
    assert.equal(reopened.task.status, 'in_progress');
    const audit = await readFile(path.join(dir, '.trellis/audit.jsonl'), 'utf8');
    assert.match(audit, /task\.reopened/);


  } finally {
    await cleanup(dir);
  }
});

test('an executor cannot reopen a done task', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'in_progress', by: 'executor:w1', note: 'try' }),
      (error) => error.code === 'TASK_REOPEN_ROLE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('reopening needs a reason', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'in_progress', by: 'human:alice' }),
      (error) => error.code === 'USAGE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('next names a candidate task while a gate is pending', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await nextAction(dir);
    assert.equal(result.kind, 'gate');
    assert.equal(result.candidate.id, 'T-001');
    assert.equal(result.candidate.blockedBy, 'G0');
  } finally {
    await cleanup(dir);
  }
});

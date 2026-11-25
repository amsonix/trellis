import test from 'node:test';
import assert from 'node:assert/strict';
import { approveGate } from '../src/core/gates.mjs';
import {
  answerTask,
  askTask,
  claimTask,
  nextAction,
  projectReport
} from '../src/core/project.mjs';
import { listRecords } from '../src/core/records.mjs';
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

async function workingTask(dir) {
  await approvePlanning(dir);
  await claimTask(dir, 'T-001', { by: 'executor:w1' });
}

test('task ask records a decision without blocking the task', async () => {
  const dir = await makeProject('generic');
  try {
    await workingTask(dir);
    const { question } = await askTask(dir, 'T-001', {
      question: 'keep the old login timeout?',
      by: 'executor:w1'
    });
    assert.equal(question.id, 'R-001');
    assert.equal(question.kind, 'decision');
    assert.equal(question.status, 'open');

    const status = await (await import('../src/core/project.mjs')).projectStatus(dir);
    assert.ok(status.attention.some((item) => item.code === 'DECISION_OPEN'));

    await claimTask(dir, 'T-001', { by: 'executor:w1' }).catch(() => {});
    const tasks = (await (await import('../src/core/tasks.mjs')).parseTasks(dir)).tasks;
    assert.equal(tasks[0].status, 'in_progress');
  } finally {
    await cleanup(dir);
  }
});

test('a human answer resolves a decision record', async () => {
  const dir = await makeProject('generic');
  try {
    await workingTask(dir);
    await askTask(dir, 'T-001', { question: 'keep the old login timeout?', by: 'executor:w1' });
    const { question } = await answerTask(dir, 'R-001', {
      decision: 'keep it, add a warning', followUp: 'none',
      by: 'human:alice'
    });
    assert.equal(question.status, 'resolved');
    assert.equal(question.resolution, 'keep it, add a warning');

    const records = await listRecords(dir, { openOnly: true });
    assert.equal(records.length, 0);
  } finally {
    await cleanup(dir);
  }
});

test('only a human may answer, and only once', async () => {
  const dir = await makeProject('generic');
  try {
    await workingTask(dir);
    await askTask(dir, 'T-001', { question: 'which timeout?', by: 'executor:w1' });

    await assert.rejects(
      () => answerTask(dir, 'R-001', { decision: 'mine', by: 'executor:w1' }),
      (error) => error.code === 'RECORD_RESOLVE_ROLE'
    );
    await answerTask(dir, 'R-001', { decision: 'thirty seconds', by: 'human:alice', followUp: 'none' });
    await assert.rejects(
      () => answerTask(dir, 'R-001', { decision: 'again', by: 'human:alice' }),
      (error) => error.code === 'RECORD_RESOLVED'
    );
  } finally {
    await cleanup(dir);
  }
});

test('multiple decision records can be asked', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await assert.rejects(
      () => askTask(dir, 'T-001', { question: 'too early?', by: 'executor:w1' }),
      (error) => error.code === 'QUESTION_NOT_ASKABLE'
    );

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const first = await askTask(dir, 'T-001', { question: 'first?', by: 'executor:w1' });
    const second = await askTask(dir, 'T-001', { question: 'second?', by: 'executor:w1' });
    assert.notEqual(first.question.id, second.question.id);
  } finally {
    await cleanup(dir);
  }
});

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

test('a question blocks the task and surfaces as needing the user', async () => {
  const dir = await makeProject('generic');
  try {
    await workingTask(dir);
    const { question } = await askTask(dir, 'T-001', {
      question: 'keep the old login timeout?',
      by: 'executor:w1'
    });
    assert.equal(question.id, 'Q-001');
    assert.equal(question.status, 'open');

    const next = await nextAction(dir);
    assert.equal(next.needsUser, true);
    assert.match(next.reason, /Q-001/);

    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w1' }),
      (error) => error.code === 'TASK_NOT_CLAIMABLE'
    );

    const report = await projectReport(dir);
    assert.equal(report.pendingQuestions.length, 1);
    assert.equal(report.pendingQuestions[0].id, 'Q-001');
  } finally {
    await cleanup(dir);
  }
});

test('a human answer resumes the task', async () => {
  const dir = await makeProject('generic');
  try {
    await workingTask(dir);
    await askTask(dir, 'T-001', { question: 'keep the old login timeout?', by: 'executor:w1' });
    const { question, task } = await answerTask(dir, 'Q-001', {
      decision: 'keep it, add a warning',
      by: 'human:alice'
    });
    assert.equal(question.status, 'answered');
    assert.equal(question.answer, 'keep it, add a warning');
    assert.equal(task.status, 'in_progress');

    const report = await projectReport(dir);
    assert.equal(report.pendingQuestions.length, 0);
    const next = await nextAction(dir);
    assert.equal(next.needsUser, false);
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
      () => answerTask(dir, 'Q-001', { decision: 'mine', by: 'executor:w1' }),
      (error) => error.code === 'QUESTION_ANSWER_ROLE'
    );
    await answerTask(dir, 'Q-001', { decision: 'thirty seconds', by: 'human:alice' });
    await assert.rejects(
      () => answerTask(dir, 'Q-001', { decision: 'again', by: 'human:alice' }),
      (error) => error.code === 'QUESTION_ANSWERED'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a task needs to be active and can only have one open question', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlanning(dir);
    await assert.rejects(
      () => askTask(dir, 'T-001', { question: 'too early?', by: 'executor:w1' }),
      (error) => error.code === 'QUESTION_NOT_ASKABLE'
    );

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await askTask(dir, 'T-001', { question: 'first?', by: 'executor:w1' });
    await assert.rejects(
      () => askTask(dir, 'T-001', { question: 'second?', by: 'executor:w1' }),
      (error) => error.code === 'QUESTION_OPEN'
    );
  } finally {
    await cleanup(dir);
  }
});

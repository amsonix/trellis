import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addTaskEvidence, claimTask, projectReport, reportTask } from '../src/core/project.mjs';
import { updateTaskStatus } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a fresh project reports the pending gate and the next action', async () => {
  const dir = await makeProject('generic');
  try {
    const report = await projectReport(dir);
    assert.equal(report.stage, 'intake');
    assert.equal(report.progress.gates.passed, 0);
    assert.equal(report.progress.gates.total, 7);
    assert.equal(report.progress.tasks.total, 1);
    assert.ok(report.gaps.some((gap) => gap.code === 'GATE_PENDING'));
    assert.equal(report.next.kind, 'gate');
  } finally {
    await cleanup(dir);
  }
});

test('a blocked task is reported with its note', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'blocked', note: 'waiting for the API key', by: 'executor:w1' });
    const report = await projectReport(dir);
    const gap = report.gaps.find((item) => item.code === 'TASK_BLOCKED');
    assert.ok(gap);
    assert.match(gap.message, /waiting for the API key/);
  } finally {
    await cleanup(dir);
  }
});

test('a done task without passing evidence is a gap', async () => {
  const dir = await makeProject('generic');
  try {
    // Bypass reportTask on purpose: this is the state the report must catch.
    await updateTaskStatus(dir, 'T-001', 'done');
    const report = await projectReport(dir);
    assert.ok(report.gaps.some((gap) => gap.code === 'EVIDENCE_NOT_PASSING'));
  } finally {
    await cleanup(dir);
  }
});

test('report aggregates milestones from the task board', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });

    const report = await projectReport(dir);
    assert.deepEqual(report.milestones[0], {
      id: 'M0',
      title: 'M0 Foundation',
      status: 'done',
      tasks: { done: 1, total: 1 }
    });
    assert.equal(report.milestones[1].status, 'empty');
  } finally {
    await cleanup(dir);
  }
});

test('a lease older than the threshold is a gap', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const leases = path.join(dir, '.trellis', 'leases.json');
    const ledger = JSON.parse(await readFile(leases, 'utf8'));
    ledger.items[0].createdAt = new Date(Date.now() - 30 * 3_600_000).toISOString();
    await writeFile(leases, JSON.stringify(ledger, null, 2));

    const report = await projectReport(dir);
    const gap = report.gaps.find((item) => item.code === 'LEASE_STALE');
    assert.ok(gap);
    assert.match(gap.message, /30h/);
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimTask, finishTask, addTaskEvidence, reportTask } from '../src/core/mutations.mjs';

async function addEvidenceTask(dir, taskId) {
  await addTaskEvidence(dir, { taskId, kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
}
async function reportTaskDone(dir, taskId, by) {
  await reportTask(dir, taskId, { state: 'done', by });
}
import { approveGate } from '../src/core/gates.mjs';
import { addTask } from '../src/core/mutations.mjs';
import { projectStatus, projectReport, taskShow } from '../src/core/project.mjs';
import { addRecord, listRecords, resolveRecord } from '../src/core/records.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('finish refuses to complete without a disposition', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await assert.rejects(
      () => finishTask(dir, 'T-001', { run: 'true', by: 'executor:w1' }),
      (error) => error.code === 'TASK_DISPOSITION_REQUIRED'
    );
    assert.equal((await parseTasks(dir)).tasks[0].status, 'in_progress');
  } finally {
    await cleanup(dir);
  }
});

test('finish with clean disposition completes directly', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const data = await finishTask(dir, 'T-001', {
      run: 'true', by: 'executor:w1', disposition: 'clear'
    });
    assert.equal(data.task.status, 'done');
    assert.equal(data.records.length, 0);
    assert.equal((await listRecords(dir)).length, 0);
  } finally {
    await cleanup(dir);
  }
});

test('finish with a gap persists the gap and shows it in status/report', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const data = await finishTask(dir, 'T-001', {
      run: 'true', by: 'executor:w1', gap: 'error path 未覆盖'
    });
    assert.equal(data.task.status, 'done');
    assert.equal(data.records.length, 1);
    assert.equal(data.records[0].kind, 'gap');

    const status = await projectStatus(dir);
    assert.ok(status.attention.some((item) => item.code === 'GAP_OPEN'));
    const report = await projectReport(dir);
    assert.ok(report.gaps.some((item) => item.code === 'GAP_OPEN'));
    const shown = await taskShow(dir, 'T-001');
    assert.equal(shown.records.length, 1);
  } finally {
    await cleanup(dir);
  }
});

test('a decision record requires a human to resolve', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await finishTask(dir, 'T-001', {
      run: 'true', by: 'executor:w1', decision: 'A/B 方案选哪个'
    });
    const record = (await listRecords(dir))[0];
    assert.equal(record.kind, 'decision');

    await assert.rejects(
      () => resolveRecord(dir, record.id, { resolution: 'mine', by: 'executor:w1' }),
      (error) => error.code === 'RECORD_RESOLVE_ROLE'
    );
    await addRecord(dir, { kind: 'gap', text: 'second gap', by: 'executor:w1' });

    await resolveRecord(dir, record.id, { resolution: 'choose B', by: 'human:alice', followUp: 'none' });
    const open = await listRecords(dir, { openOnly: true });
    assert.equal(open.length, 1);
    assert.equal(open[0].kind, 'gap');
  } finally {
    await cleanup(dir);
  }
});

test('G6 fails while a decision record is open', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
      ['G3', 'human:alice'], ['G4', 'coordinator:kim']
    ]) await approveGate(dir, gate, { by });
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await finishTask(dir, 'T-001', {
      run: 'true', by: 'executor:w1', decision: 'which API?'
    });
    await approveGate(dir, 'G5', { taskId: 'T-001', by: 'reviewer:rita' });
    await assert.rejects(
      () => approveGate(dir, 'G6', { by: 'verifier:vic' }),
      (error) => error.code === 'GATE_BLOCKED' &&
        error.details.checks.some((check) => check.code === 'DECISION_OPEN')
    );
  } finally {
    await cleanup(dir);
  }
});

test('a gap referenced in Source resolves when its task is done', async () => {
  const dir = await makeProject('generic');
  try {
    const gap = await addRecord(dir, {
      kind: 'gap', text: 'error path 未覆盖', fromTask: 'T-001', by: 'executor:w1'
    });
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const added = await addTask(dir, {
      title: 'Fix gap', scope: 'docs/gap', acceptance: 'g', verification: 'manual',
      source: `RECORD#${gap.id}`, by: 'executor:w1'
    });
    await claimTask(dir, added.task.id, { by: 'executor:w1' });
    await addEvidenceTask(dir, added.task.id);
    await reportTaskDone(dir, added.task.id, 'executor:w1');

    const records = await listRecords(dir);
    const after = records.find((item) => item.id === gap.id);
    assert.equal(after.status, 'resolved');
    assert.match(after.resolution, /T-002/);
  } finally {
    await cleanup(dir);
  }
});

test('G6 fails when a required decision has no follow-up task', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
      ['G3', 'human:alice'], ['G4', 'coordinator:kim']
    ]) await approveGate(dir, gate, { by });
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidenceTask(dir, 'T-001');
    await finishTask(dir, 'T-001', { run: 'true', by: 'executor:w1', disposition: 'clear' });
    await approveGate(dir, 'G5', { taskId: 'T-001', by: 'reviewer:rita' });

    const decision = await addRecord(dir, {
      kind: 'decision', text: 'add error handling', by: 'human:alice'
    });
    await resolveRecord(dir, decision.id, {
      resolution: 'yes, add it', by: 'human:alice', followUp: 'required'
    });

    await assert.rejects(
      () => approveGate(dir, 'G6', { by: 'verifier:vic' }),
      (error) => error.code === 'GATE_BLOCKED' &&
        error.details.checks.some((check) => check.code === 'DECISION_UNFULFILLED')
    );
  } finally {
    await cleanup(dir);
  }
});

test('G6 passes when a required decision has a follow-up task', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
      ['G3', 'human:alice'], ['G4', 'coordinator:kim']
    ]) await approveGate(dir, gate, { by });
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidenceTask(dir, 'T-001');
    await finishTask(dir, 'T-001', { run: 'true', by: 'executor:w1', disposition: 'clear' });
    await approveGate(dir, 'G5', { taskId: 'T-001', by: 'reviewer:rita' });

    const decision = await addRecord(dir, {
      kind: 'decision', text: 'add error handling', by: 'human:alice'
    });
    await resolveRecord(dir, decision.id, {
      resolution: 'yes', by: 'human:alice', followUp: 'required'
    });
    // Give the existing done task the RECORD# source (no new task, no stale plan).
    const file = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('ROADMAP#M0/exit-1', `RECORD#${decision.id}`));

    await approveGate(dir, 'G6', { by: 'verifier:vic' }).catch(() => {});
    const { gateChecks } = await import('../src/core/gates.mjs');
    const { getProfile } = await import('../src/core/profiles.mjs');
    const { loadState } = await import('../src/core/store.mjs');
    const { parseTasks } = await import('../src/core/tasks.mjs');
    const checks = await gateChecks(dir, 'G6', {
      profile: getProfile('generic'),
      state: await loadState(dir),
      tasks: (await parseTasks(dir)).tasks
    });
    assert.ok(!checks.some((check) => check.code === 'DECISION_UNFULFILLED'));
  } finally {
    await cleanup(dir);
  }
});

test('record list filters by status and severity', async () => {
  const dir = await makeProject('generic');
  try {
    const high = await addRecord(dir, { kind: 'gap', text: 'high gap', severity: 'high', by: 'executor:w1' });
    await addRecord(dir, { kind: 'gap', text: 'low gap', severity: 'low', by: 'executor:w1' });
    const decision = await addRecord(dir, { kind: 'decision', text: 'pick one', by: 'executor:w1' });
    await resolveRecord(dir, decision.id, { resolution: 'B', by: 'human:alice', followUp: 'none' });

    assert.deepEqual((await listRecords(dir, { status: 'resolved' })).map((r) => r.id), [decision.id]);
    assert.deepEqual((await listRecords(dir, { status: 'open', severity: 'high' })).map((r) => r.id), [high.id]);
    assert.equal((await listRecords(dir, { severity: 'low' })).length, 1);
    assert.equal((await listRecords(dir)).length, 3);
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { claimTask, finishTask } from '../src/core/mutations.mjs';
import { approveGate } from '../src/core/gates.mjs';
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

    await resolveRecord(dir, record.id, { resolution: 'choose B', by: 'human:alice' });
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

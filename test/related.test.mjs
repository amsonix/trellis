import test from 'node:test';
import assert from 'node:assert/strict';
import { addEvidence, addTask, claimTask, reportTask } from '../src/core/mutations.mjs';
import { nextAction, taskShow } from '../src/core/project.mjs';
import { approveGate } from '../src/core/gates.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a new task sees prior conclusions from the same Source', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1'
    });
    await reportTask(dir, 'T-001', {
      state: 'done',
      by: 'executor:w1',
      note: 'decision: use the streaming parser; pitfall: do not buffer the whole file'
    });

    await addTask(dir, {
      title: 'Follow the same criterion',
      scope: 'docs/b',
      acceptance: 'b',
      verification: 'manual',
      source: 'ROADMAP#M0/exit-1',
      by: 'architect:ann'
    });

    const shown = await taskShow(dir, 'T-002');
    const prior = shown.related.find((item) => item.id === 'T-001');
    assert.ok(prior, JSON.stringify(shown.related));
    assert.match(prior.note, /do not buffer the whole file/);
    assert.equal(prior.source, 'ROADMAP#M0/exit-1');

    await approveGate(dir, 'G0', { by: 'human:alice' });
    await approveGate(dir, 'G1', { by: 'architect:ann' });
    await approveGate(dir, 'G2', { by: 'architect:ann' });
    await approveGate(dir, 'G3', { by: 'human:alice' });
    await approveGate(dir, 'G4', { by: 'coordinator:kim' });
    await approveGate(dir, 'G5', { by: 'reviewer:rita', taskId: 'T-001' });

    const next = await nextAction(dir, 'executor', { batch: 1 });
    assert.ok(Array.isArray(next.tasks), JSON.stringify(next));
    const candidate = next.tasks.find((item) => item.id === 'T-002');
    assert.ok(candidate, JSON.stringify(next));
    assert.ok(candidate.related.some((item) => item.id === 'T-001'));
  } finally {
    await cleanup(dir);
  }
});

test('claim returns prior conclusions so the agent sees them before writing', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1'
    });
    await reportTask(dir, 'T-001', {
      state: 'done', by: 'executor:w1', note: 'decision: keep the cache bounded; pitfall: unbounded growth'
    });
    await addTask(dir, {
      title: 'Next slice', scope: 'docs/b', acceptance: 'b', verification: 'manual',
      source: 'ROADMAP#M0/exit-1', by: 'architect:ann'
    });

    const claimed = await claimTask(dir, 'T-002', { by: 'executor:w2' });
    const prior = claimed.related.find((item) => item.id === 'T-001');
    assert.ok(prior, JSON.stringify(claimed.related));
    assert.match(prior.note, /unbounded growth/);
  } finally {
    await cleanup(dir);
  }
});

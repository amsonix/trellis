import test from 'node:test';
import assert from 'node:assert/strict';
import { addEvidence, addTask, claimTask, reportTask } from '../src/core/mutations.mjs';
import { taskShow } from '../src/core/project.mjs';
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
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { appendAudit, loadState, saveState } from '../src/core/store.mjs';
import { addTaskEvidence, claimTask } from '../src/core/mutations.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const auditLines = async (dir) =>
  (await readFile(path.join(dir, '.trellis/audit.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

test('audit entries are appended to audit.jsonl', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const lines = await auditLines(dir);
    assert.ok(lines.length >= 2);
    assert.equal(lines.at(-1).action, 'task.claimed');
    const state = await loadState(dir);
    assert.ok(state.audit.length <= 200);
  } finally {
    await cleanup(dir);
  }
});

test('state keeps only the most recent audit entries', async () => {
  const dir = await makeProject('generic');
  try {
    const state = await loadState(dir);
    for (let i = 0; i < 250; i += 1) appendAudit(state, 'test.entry', null, { i });
    await saveState(dir, state);

    const reloaded = await loadState(dir);
    assert.equal(reloaded.audit.length, 200);
    assert.equal(reloaded.audit.at(-1).detail.i, 249);

    const lines = await auditLines(dir);
    assert.equal(lines.filter((line) => line.action === 'test.entry').length, 250);
  } finally {
    await cleanup(dir);
  }
});

test('reloading does not duplicate audit lines', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const before = (await auditLines(dir)).length;
    await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
    const after = (await auditLines(dir)).length;
    assert.equal(after, before + 1);
  } finally {
    await cleanup(dir);
  }
});

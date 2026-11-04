import test from 'node:test';
import assert from 'node:assert/strict';
import { access, appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimTask, compact, reportTask } from '../src/core/mutations.mjs';
import { addTask } from '../src/core/project.mjs';
import { listEvidence } from '../src/core/evidence.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

test('claim by a role that does not own the task is refused even when a lease exists', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:alice' });
    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'architect:bob' }),
      (error) => error.code === 'TASK_ROLE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('done rechecks dependencies added after the claim', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'Dependent later', scope: 'docs/later', acceptance: 'implemented', verification: 'manual', by: 'coordinator:kim'
    });
    await claimTask(dir, 'T-002', { by: 'executor:w1' });

    const file = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('| docs/later | - |', '| docs/later | T-001 |'));

    await import('../src/core/evidence.mjs').then(({ addEvidence }) =>
      addEvidence(dir, { taskId: 'T-002', kind: 'test', uri: 'manual', verdict: 'pass', by: 'verifier:ci' })
    );
    await assert.rejects(
      () => reportTask(dir, 'T-002', { state: 'done', by: 'executor:w1' }),
      (error) => error.code === 'TASK_BLOCKED_BY_DEPENDENCY'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a corrupt middle evidence line is an error, not silently dropped', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await import('../src/core/evidence.mjs').then(({ addEvidence }) =>
      addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'one', verdict: 'pass', by: 'executor:w1' })
    );
    const file = path.join(dir, '.trellis/evidence/T-001.jsonl');
    await appendFile(file, 'NOT JSON\n');
    await assert.rejects(
      () => listEvidence(dir),
      (error) => error.code === 'EVIDENCE_CORRUPT' && /line 2/.test(error.message)
    );
  } finally {
    await cleanup(dir);
  }
});

test('the per-task evidence read returns the same records as the full read', async () => {
  const dir = await makeProject('generic');
  try {
    const { addEvidence } = await import('../src/core/evidence.mjs');
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'a', verdict: 'pass', by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-002', kind: 'test', uri: 'b', verdict: 'fail', by: 'executor:w1' });
    const all = await listEvidence(dir);
    const only = await listEvidence(dir, 'T-001');
    assert.equal(all.length, 2);
    assert.deepEqual(only.map((record) => record.id), all.filter((record) => record.taskId === 'T-001').map((record) => record.id));
  } finally {
    await cleanup(dir);
  }
});

test('a torn final evidence line is ignored', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await import('../src/core/evidence.mjs').then(({ addEvidence }) =>
      addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'one', verdict: 'pass', by: 'executor:w1' })
    );
    await appendFile(path.join(dir, '.trellis/evidence/T-001.jsonl'), '{"type":"add"');
    assert.equal((await listEvidence(dir)).length, 1);
  } finally {
    await cleanup(dir);
  }
});

test('compact dry-run does not migrate a legacy evidence file', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(path.join(dir, '.trellis/evidence.json'), '{"schemaVersion":1,"items":[]}');
    await compact(dir, { dryRun: true });
    await access(path.join(dir, '.trellis/evidence.json'));
    await assert.rejects(() => access(path.join(dir, '.trellis/evidence.json.migrated')));
  } finally {
    await cleanup(dir);
  }
});

test('schema 1 state upgrades to 3 on the next write', async () => {
  const dir = await makeProject('generic');
  try {
    const file = path.join(dir, '.trellis/state.json');
    const state = await readJson(file);
    state.schemaVersion = 1;
    await writeFile(file, JSON.stringify(state));

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    assert.equal((await readJson(file)).schemaVersion, 3);
  } finally {
    await cleanup(dir);
  }
});

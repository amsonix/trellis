import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { addTask, cancelTask, claimTask, reportTask } from '../src/core/mutations.mjs';
import { addEvidence } from '../src/core/evidence.mjs';
import { releaseLease } from '../src/core/lease.mjs';
import { approveGate } from '../src/core/gates.mjs';
import { nextAction } from '../src/core/project.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

async function run(dir, args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [bin, ...args], { cwd: dir });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function child(dir, overrides = {}) {
  return addTask(dir, {
    title: 'Child', scope: 'src/child', acceptance: 'child works', verification: 'manual',
    parent: 'T-001', by: 'architect:ann', ...overrides
  });
}

test('a child records its parent and openChildren', async () => {
  const dir = await makeProject('generic');
  try {
    await child(dir);
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[1].parent, 'T-001');
    const listed = await run(dir, ['task', 'list', '--json']);
    const data = JSON.parse(listed.stdout).data;
    assert.equal(data.tasks[0].openChildren, 1);
    assert.deepEqual(data.tasks[0].children, ['T-002']);
    assert.equal(data.tasks[1].parent, 'T-001');
    const only = await run(dir, ['task', 'list', '--children-of', 'T-001', '--json']);
    assert.deepEqual(JSON.parse(only.stdout).data.tasks.map((task) => task.id), ['T-002']);
  } finally {
    await cleanup(dir);
  }
});

test('a parent cannot be done while a child is open', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    await releaseLease(dir, 'T-001', 'executor:w1');
    await child(dir);
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' }),
      (error) => error.code === 'TASK_OPEN_CHILDREN'
    );
    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w1' }),
      (error) => error.code === 'PARENT_HAS_OPEN_CHILDREN'
    );
  } finally {
    await cleanup(dir);
  }
});

test('closing the child lets the parent close', async () => {
  const dir = await makeProject('generic');
  try {
    await child(dir);
    await claimTask(dir, 'T-002', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-002', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-002', { state: 'done', by: 'executor:w1' });

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    const parent = await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    assert.equal(parent.task.status, 'done');
  } finally {
    await cleanup(dir);
  }
});

test('parent creation enforces lease, scope, state and depth', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await assert.rejects(() => child(dir), (error) => error.code === 'PARENT_LEASE_HELD');
    await reportTask(dir, 'T-001', { state: 'pending', reason: 'integration review', by: 'executor:w1' });
    await releaseLease(dir, 'T-001', 'executor:w1');

    await assert.rejects(() => child(dir, { scope: 'docs/out' }), (error) => error.code === 'TASK_PARENT_SCOPE');
    await assert.rejects(() => child(dir, { parent: 'T-999' }), (error) => error.code === 'TASK_PARENT_UNKNOWN');
  } finally {
    await cleanup(dir);
  }
});

test('parent-child scope overlap is exempt from G4', async () => {
  const dir = await makeProject('generic');
  try {
    await child(dir);
    for (const [gate, by] of [
      ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
      ['G3', 'human:alice'], ['G4', 'coordinator:kim']
    ]) await approveGate(dir, gate, { by });
    const next = await nextAction(dir, 'executor');
    assert.equal(next.kind, 'tasks');
    assert.ok(next.tasks.some((task) => task.parent === 'T-001'));
    assert.ok(next.tasks.find((task) => task.id === 'T-001').openChildren >= 1);
  } finally {
    await cleanup(dir);
  }
});

test('canceling a parent needs --cascade once children exist', async () => {
  const dir = await makeProject('generic');
  try {
    await child(dir);
    await assert.rejects(
      () => cancelTask(dir, 'T-001', { by: 'human:alice', reason: 'drop' }),
      (error) => error.code === 'TASK_OPEN_CHILDREN'
    );
    await cancelTask(dir, 'T-001', { by: 'human:alice', reason: 'drop', cascade: true });
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.find((task) => task.id === 'T-001').status, 'canceled');
    assert.equal(tasks.find((task) => task.id === 'T-002').status, 'canceled');
  } finally {
    await cleanup(dir);
  }
});

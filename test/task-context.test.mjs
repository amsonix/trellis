import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { approveGate } from '../src/core/gates.mjs';
import { addTask } from '../src/core/mutations.mjs';
import { nextAction, taskShow } from '../src/core/project.mjs';
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

async function approvePlan(dir) {
  for (const [gate, by] of [
    ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
    ['G3', 'human:alice'], ['G4', 'coordinator:kim']
  ]) await approveGate(dir, gate, { by });
}

test('task show --context returns the read set, children and evidence state', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'Child', scope: 'src/child', acceptance: 'child works', verification: 'manual',
      parent: 'T-001', by: 'architect:ann'
    });
    const shown = await taskShow(dir, 'T-001', { context: true });
    assert.equal(shown.task.id, 'T-001');
    assert.equal(shown.openChildren, 1);
    assert.deepEqual(shown.children.map((child) => child.id), ['T-002']);
    assert.ok(shown.read.includes('.trellis/PROJECT.md'));
    assert.ok(shown.read.includes('.trellis/docs/ROADMAP.md'));
    assert.ok(shown.read.includes('.trellis/docs/TASKS.md'));
    assert.equal(shown.evidence.active, 0);
    assert.deepEqual(shown.leases, []);
    assert.match(shown.claimCommand, /T-001/);

    const child = await taskShow(dir, 'T-002', { context: true });
    assert.equal(child.parent.id, 'T-001');
  } finally {
    await cleanup(dir);
  }
});

test('next --context attaches the read set and roll-up fields', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'Child', scope: 'src/child', acceptance: 'child works', verification: 'manual',
      parent: 'T-001', by: 'architect:ann'
    });
    await approvePlan(dir);
    const result = await nextAction(dir, 'executor', { context: true });
    assert.equal(result.kind, 'tasks');
    assert.ok(result.read.includes('.trellis/docs/TASKS.md'));
    assert.ok(result.tasks.every((task) => Array.isArray(task.read)));
    const parent = result.tasks.find((task) => task.id === 'T-001');
    assert.equal(parent.openChildren, 1);
  } finally {
    await cleanup(dir);
  }
});

test('the CLI exposes task show --context and next --context', async () => {
  const dir = await makeProject('generic');
  try {
    const shown = await run(dir, ['task', 'show', 'T-001', '--context', '--json']);
    assert.equal(shown.code, 0, shown.stderr || shown.stdout);
    const data = JSON.parse(shown.stdout).data;
    assert.ok(data.read.includes('.trellis/PROJECT.md'));
    assert.ok(data.claimCommand);
  } finally {
    await cleanup(dir);
  }
});

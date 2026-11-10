import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { approveGate } from '../src/core/gates.mjs';
import { addTask, claimTask } from '../src/core/mutations.mjs';
import { nextAction } from '../src/core/project.mjs';
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

test('an unknown --status is refused with the valid values', async () => {
  const dir = await makeProject('generic');
  try {
    const bad = await run(dir, ['task', 'list', '--status', 'bogus', '--json']);
    assert.equal(bad.code, 2);
    const body = JSON.parse(bad.stdout);
    assert.equal(body.error.code, 'USAGE');
    assert.match(body.error.message, /todo/);

    const empty = await run(dir, ['task', 'list', '--status', '', '--json']);
    assert.equal(empty.code, 2);
  } finally {
    await cleanup(dir);
  }
});

test('task list help names its filters and --to is accepted', async () => {
  const dir = await makeProject('generic');
  try {
    const help = await run(dir, ['help', 'task:list']);
    assert.match(help.stdout, /--status/);
    assert.match(help.stdout, /--ready/);

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await run(dir, ['lease', 'release', 'T-001', '--by', 'executor:w1']);
    const recovered = await run(dir, ['task', 'recover', 'T-001', '--by', 'human:alice', '--reason', 'reset', '--to', 'todo', '--json']);
    assert.equal(recovered.code, 0, recovered.stderr || recovered.stdout);
    assert.equal(JSON.parse(recovered.stdout).data.task.status, 'todo');
  } finally {
    await cleanup(dir);
  }
});

test('task list JSON exposes both tasks and items', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await run(dir, ['task', 'list', '--json']);
    const data = JSON.parse(result.stdout).data;
    assert.ok(Array.isArray(data.tasks));
    assert.deepEqual(data.items, data.tasks);
  } finally {
    await cleanup(dir);
  }
});

test('a stale passed gate does not outrank ready execution', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
      ['G3', 'human:alice'], ['G4', 'coordinator:kim']
    ]) await approveGate(dir, gate, { by });

    await addTask(dir, {
      title: 'Later plan change', scope: 'docs/b', acceptance: 'b', verification: 'manual', by: 'architect:ann'
    });

    const result = await nextAction(dir, 'executor');
    assert.equal(result.kind, 'tasks');
    assert.ok(result.attention.some((item) => item.code === 'GATE_STALE'));
    assert.ok(result.tasks.every((task) => task.blockedBy === undefined));
  } finally {
    await cleanup(dir);
  }
});

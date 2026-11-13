import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { addEvidence } from '../src/core/evidence.mjs';
import { addTask, cancelTask, claimTask, reportTask } from '../src/core/mutations.mjs';
import { leaseStatus } from '../src/core/lease.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
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

test('a third party cannot push a leased task into blocked', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await assert.rejects(
      () => reportTask(dir, 'T-001', { state: 'blocked', by: 'coordinator:kim' }),
      (error) => error.code === 'TASK_LEASE_HELD_BY_OTHER'
    );
    await reportTask(dir, 'T-001', { state: 'blocked', by: 'executor:w1' });
    assert.equal((await parseTasks(dir)).tasks[0].status, 'blocked');
  } finally {
    await cleanup(dir);
  }
});

test('a done task can be canceled directly', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    await cancelTask(dir, 'T-001', { by: 'human:alice', reason: 'decided not to ship' });
    assert.equal((await parseTasks(dir)).tasks[0].status, 'canceled');
  } finally {
    await cleanup(dir);
  }
});

test('claim --dry-run checks conflicts without acquiring a lease', async () => {
  const dir = await makeProject('generic');
  try {
    const preview = await claimTask(dir, 'T-001', { by: 'executor:w1', dryRun: true });
    assert.equal(preview.dryRun, true);
    assert.equal((await leaseStatus(dir)).length, 0);
    assert.equal((await parseTasks(dir)).tasks[0].status, 'todo');

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addTask(dir, {
      title: 'Second', scope: 'docs/b', acceptance: 'b', verification: 'manual', by: 'architect:ann'
    });
    const board = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(board, 'utf8');
    await writeFile(board, text.replace('| docs/b |', '| src/b |'));
    await assert.rejects(
      () => claimTask(dir, 'T-002', { by: 'executor:w2', paths: 'src/b', dryRun: true }),
      (error) => error.code === 'LEASE_CONFLICT'
    );
    assert.equal((await leaseStatus(dir)).length, 1);
  } finally {
    await cleanup(dir);
  }
});

test('a camelCase option gets a spelling suggestion', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await run(dir, ['task', 'edit', 'T-001', '--dependsOn', 'T-002', '--by', 'architect:ann', '--json']);
    assert.equal(result.code, 2);
    assert.match(JSON.parse(result.stdout).error.message, /did you mean --depends-on/);
  } finally {
    await cleanup(dir);
  }
});

test('a fail from another commit no longer blocks done', async () => {
  const dir = await makeProject('generic');
  const git = (...args) => execFileAsync('git', ['-C', dir, ...args]);
  try {
    await git('init', '-q');
    await git('add', '-A');
    await git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init');
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'fail', by: 'executor:w1' });
    await git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--allow-empty', '-qm', 'later');
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });

    const result = await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    assert.equal(result.task.status, 'done');
  } finally {
    await cleanup(dir);
  }
});

test('evidence add --proves is stored', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await run(dir, [
      'evidence', 'add', '--task', 'T-001', '--kind', 'test', '--uri', 'manual',
      '--verdict', 'pass', '--proves', 'the acceptance clause', '--by', 'executor:w1', '--json'
    ]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).data.proves, 'the acceptance clause');
    const list = await run(dir, ['evidence', 'list', '--task', 'T-001', '--json']);
    assert.equal(JSON.parse(list.stdout).data.items[0].proves, 'the acceptance clause');
  } finally {
    await cleanup(dir);
  }
});

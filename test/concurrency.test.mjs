import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initProject } from '../src/core/project.mjs';
import { claimTask } from '../src/core/mutations.mjs';
import { appendTask, cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

async function run(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [bin, ...args], { maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

test('parallel evidence writes are not lost', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-conc-ev-'));
  try {
    await initProject({ dir, name: 'demo', profile: 'generic' });
    const runs = [];
    for (let i = 1; i <= 10; i += 1) {
      runs.push(
        run(['evidence', 'add', '--task', 'T-001', '--kind', 'test', '--uri', `case-${i}`,
          '--verdict', 'pass', '--by', 'executor:w1', '--dir', dir, '--json'])
      );
    }
    await Promise.all(runs);

    const lines = (await readFile(path.join(dir, '.trellis/evidence/T-001.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const adds = lines.filter((event) => event.type === 'add');
    assert.equal(adds.length, 10);
    assert.equal(new Set(adds.map((event) => event.uri)).size, 10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parallel claims for overlapping scopes leave exactly one lease', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-conc-lease-'));
  try {
    await initProject({ dir, name: 'demo', profile: 'generic' });
    const tasks = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(tasks, 'utf8');
    await rm(tasks);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      tasks,
      `${text}| T-002 | M0 | Second | executor | src | - | works | npm test | todo |\n`
    );

    await Promise.all([
      run(['task', 'claim', 'T-001', '--by', 'executor:a', '--dir', dir, '--json']),
      run(['task', 'claim', 'T-002', '--by', 'executor:b', '--dir', dir, '--json'])
    ]);

    const ledger = await readJson(path.join(dir, '.trellis/leases.json'));
    const held = ledger.items.filter((lease) => lease.state === 'held');
    assert.equal(held.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the in-process lock serializes parallel callers without deadlocking', async () => {
  const dir = await makeProject('generic');
  try {
    await appendTask(dir, '| T-002 | M0 | Second | executor | src | - | works | npm test | todo |');
    const results = await Promise.allSettled([
      claimTask(dir, 'T-001', { by: 'executor:a' }),
      claimTask(dir, 'T-002', { by: 'executor:b' })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'LEASE_CONFLICT');
  } finally {
    await cleanup(dir);
  }
});

test('the lock file is removed after the command finishes', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:a' });
    const { access } = await import('node:fs/promises');
    await assert.rejects(() => access(path.join(dir, '.trellis/.lock')));
  } finally {
    await cleanup(dir);
  }
});

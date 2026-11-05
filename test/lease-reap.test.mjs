import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { claimTask, addTaskEvidence } from '../src/core/mutations.mjs';
import { cleanup, makeProject } from './helpers.mjs';

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

test('the CLI routes lease reap to the reaper', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const file = path.join(dir, '.trellis/leases.json');
    const ledger = JSON.parse(await readFile(file, 'utf8'));
    ledger.items[0].createdAt = '2020-01-01T00:00:00.000Z';
    await writeFile(file, JSON.stringify(ledger));

    const result = await run(['lease', 'reap', '--older-than', '1', '--by', 'human:alice', '--dir', dir, '--json']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout).data;
    assert.deepEqual(data.released, ['T-001']);

    const status = await run(['lease', 'status', '--dir', dir, '--json']);
    assert.deepEqual(JSON.parse(status.stdout).data.items, []);
  } finally {
    await cleanup(dir);
  }
});

test('a coordinator may reap a lease with no activity after the claim', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const file = path.join(dir, '.trellis/leases.json');
    const ledger = JSON.parse(await readFile(file, 'utf8'));
    ledger.items[0].createdAt = '2020-01-01T00:00:00.000Z';
    await writeFile(file, JSON.stringify(ledger));

    const result = await run(['lease', 'reap', '--older-than', '1', '--reason', 'lane exited', '--by', 'coordinator:kim', '--dir', dir, '--json']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).data.released, ['T-001']);
  } finally {
    await cleanup(dir);
  }
});

test('a coordinator cannot reap a lease whose task has activity', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const file = path.join(dir, '.trellis/leases.json');
    const ledger = JSON.parse(await readFile(file, 'utf8'));
    ledger.items[0].createdAt = '2020-01-01T00:00:00.000Z';
    await writeFile(file, JSON.stringify(ledger));
    await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });

    const result = await run(['lease', 'reap', '--older-than', '1', '--reason', 'lane exited', '--by', 'coordinator:kim', '--dir', dir, '--json']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout).data;
    assert.deepEqual(data.released, []);
    assert.equal(data.skipped[0].code, 'LEASE_HAS_ACTIVITY');

    const noReason = await run(['lease', 'reap', '--older-than', '1', '--by', 'coordinator:kim', '--dir', dir, '--json']);
    assert.equal(noReason.code, 2);
  } finally {
    await cleanup(dir);
  }
});

test('lease status prints a held lease without throwing', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const result = await run(['lease', 'status', '--dir', dir]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /T-001/);
    assert.match(result.stdout, /idle/);
  } finally {
    await cleanup(dir);
  }
});

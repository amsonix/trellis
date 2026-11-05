import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { claimTask } from '../src/core/mutations.mjs';
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

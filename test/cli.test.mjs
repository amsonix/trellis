import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/project-protocol.mjs', import.meta.url));

async function run(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...args], { maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('the CLI exposes a JSON envelope and the main workflow', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-'));
  try {
    const init = await run(['init', dir, '--profile', 'cli', '--name', 'demo', '--json']);
    assert.equal(init.code, 0);
    const initJson = JSON.parse(init.stdout);
    assert.equal(initJson.ok, true);
    assert.equal(initJson.data.profile, 'cli');

    const status = await run(['status', '--dir', dir, '--json']);
    assert.equal(status.code, 0);
    const statusJson = JSON.parse(status.stdout);
    assert.equal(statusJson.data.stage, 'intake');

    const check = await run(['check', '--dir', dir, '--json']);
    assert.equal(check.code, 0);
    assert.equal(JSON.parse(check.stdout).data.summary.fail, 0);

    const gate = await run(['gate', 'G0', '--approve', '--by', 'human:alice', '--dir', dir, '--json']);
    assert.equal(gate.code, 0);
    assert.equal(JSON.parse(gate.stdout).data.status, 'passed');

    const tasks = await run(['task', 'list', '--dir', dir, '--json']);
    assert.equal(tasks.code, 0);
    assert.equal(JSON.parse(tasks.stdout).data.tasks.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('usage errors exit 2 and still produce JSON when asked', async () => {
  const result = await run(['gate', 'G0', '--approve', '--json']);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'USAGE');
});

test('the CLI prints its version', async () => {
  const result = await run(['--version']);
  assert.equal(result.code, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

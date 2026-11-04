import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = path.resolve(fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url)));

async function run(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [bin, ...args]);
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '' };
  }
}

test('per-command help is available and unknown subjects fail', async () => {
  const task = await run(['help', 'task', 'add']);
  assert.equal(task.code, 0);
  assert.match(task.stdout, /trellis task add/);

  const flag = await run(['task', '--help']);
  assert.equal(flag.code, 0);
  assert.match(flag.stdout, /Subcommands: .*add/);

  const unknown = await run(['help', 'nope']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /no help for 'nope'/);
});

test('doctor reports a healthy project', async () => {
  const dir = await makeProject('generic');
  try {
    const { code, stdout } = await run(['doctor', '--dir', dir, '--json']);
    assert.equal(code, 0);
    const data = JSON.parse(stdout).data;
    const codes = data.checks.map((check) => check.code);
    assert.ok(codes.includes('STATE_OK'));
    assert.ok(codes.includes('TASKS_OK'));
    assert.ok(codes.includes('EVIDENCE_OK'));
    assert.ok(codes.includes('NODE_VERSION'));
    assert.equal(data.summary.fail, 0);
  } finally {
    await cleanup(dir);
  }
});

test('doctor fails on a missing project and a corrupt evidence log', async () => {
  const missing = await run(['doctor', '--dir', path.join('/tmp', 'definitely-not-trellis'), '--json']);
  assert.equal(missing.code, 3);
  assert.ok(JSON.parse(missing.stdout).data.checks.some((check) => check.code === 'STATE_BROKEN'));

  const dir = await makeProject('generic');
  try {
    await mkdir(path.join(dir, '.trellis/evidence'), { recursive: true });
    await appendFile(path.join(dir, '.trellis/evidence/T-001.jsonl'), 'NOT JSON\n');
    const corrupt = await run(['doctor', '--dir', dir, '--json']);
    assert.equal(corrupt.code, 3);
    assert.ok(JSON.parse(corrupt.stdout).data.checks.some((check) => check.code === 'EVIDENCE_BROKEN'));
  } finally {
    await cleanup(dir);
  }
});

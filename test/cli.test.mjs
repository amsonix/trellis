import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

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

test('lease release frees the write domain', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-lease-'));
  try {
    await run(['init', dir, '--name', 'demo', '--json']);
    const claim = await run(['task', 'claim', 'T-001', '--by', 'executor:w1', '--dir', dir, '--json']);
    assert.equal(claim.code, 0);

    const held = JSON.parse((await run(['lease', 'status', '--dir', dir, '--json'])).stdout);
    assert.equal(held.data.items.length, 1);

    const release = await run(['lease', 'release', 'T-001', '--by', 'coordinator:lead', '--dir', dir, '--json']);
    assert.equal(release.code, 0);
    assert.equal(JSON.parse(release.stdout).data.released, true);

    const after = JSON.parse((await run(['lease', 'status', '--dir', dir, '--json'])).stdout);
    assert.equal(after.data.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refusals exit 3 and missing state exits 4', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-refuse-'));
  try {
    await run(['init', dir, '--name', 'demo', '--json']);

    const noLease = await run(['lease', 'release', 'T-001', '--by', 'coordinator:lead', '--dir', dir, '--json']);
    assert.equal(noLease.code, 3);
    assert.equal(JSON.parse(noLease.stdout).error.code, 'LEASE_NOT_HELD');

    const wrongOrder = await run(['gate', 'G1', '--approve', '--by', 'architect:a', '--dir', dir, '--json']);
    assert.equal(wrongOrder.code, 3);

    const noEvidence = await run(['task', 'report', 'T-001', '--state', 'done', '--by', 'executor:w1', '--dir', dir, '--json']);
    assert.equal(noEvidence.code, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const missing = await run(['status', '--dir', path.join(os.tmpdir(), 'pp-missing-state'), '--json']);
  assert.equal(missing.code, 4);
});

test('unknown commands are usage errors', async () => {
  const result = await run(['nope', '--json']);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).error.code, 'USAGE');
});

test('the brief command prints a role brief', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-brief-'));
  try {
    await run(['init', dir, '--name', 'demo', '--json']);
    const brief = await run(['brief', dir, '--role', 'architect', '--json']);
    assert.equal(brief.code, 0);
    const payload = JSON.parse(brief.stdout).data;
    assert.equal(payload.gate.id, 'G0');
    assert.ok(payload.read.includes('.trellis/PROJECT.md'));

    const unknown = await run(['brief', dir, '--role', 'wizard', '--json']);
    assert.equal(unknown.code, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('task add writes the task board', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-add-'));
  try {
    await run(['init', dir, '--name', 'demo', '--json']);
    const add = await run([
      'task', 'add',
      '--title', 'Fix the login crash reported in testing',
      '--scope', 'src/auth, test',
      '--acceptance', 'a regression test covers the crash and passes',
      '--verification', 'npm test',
      '--depends-on', 'T-001',
      '--by', 'coordinator:kim',
      '--dir', dir,
      '--json'
    ]);
    assert.equal(add.code, 0);
    assert.equal(JSON.parse(add.stdout).data.task.id, 'T-002');

    const list = await run(['task', 'list', '--dir', dir, '--json']);
    assert.equal(JSON.parse(list.stdout).data.tasks.length, 2);

    const bad = await run([
      'task', 'add', '--title', 'x', '--scope', 'docs', '--acceptance', 'y',
      '--verification', 'z', '--milestone', 'M9', '--by', 'coordinator:kim', '--dir', dir, '--json'
    ]);
    assert.equal(bad.code, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the report command summarises progress and gaps', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-report-'));
  try {
    await run(['init', dir, '--name', 'demo', '--json']);
    const json = await run(['report', dir, '--json']);
    assert.equal(json.code, 0);
    const payload = JSON.parse(json.stdout).data;
    assert.equal(payload.progress.gates.total, 7);
    assert.ok(payload.gaps.some((gap) => gap.code === 'GATE_PENDING'));

    const text = await run(['report', dir]);
    assert.equal(text.code, 0);
    assert.match(text.stdout, /Trellis report/);
    assert.match(text.stdout, /GATE_PENDING/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the read side of the CLI returns envelopes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-read-'));
  try {
    await run(['init', dir, '--name', 'demo', '--json']);

    const next = await run(['next', '--role', 'architect', '--dir', dir, '--json']);
    assert.equal(next.code, 0);
    assert.equal(JSON.parse(next.stdout).data.kind, 'gate');

    const profiles = await run(['profile', 'list', '--json']);
    assert.equal(profiles.code, 0);
    assert.equal(JSON.parse(profiles.stdout).data.profiles.length, 4);

    const add = await run([
      'evidence', 'add', '--task', 'T-001', '--kind', 'test', '--uri', 'npm test',
      '--verdict', 'pass', '--by', 'executor:w1', '--dir', dir, '--json'
    ]);
    assert.equal(add.code, 0);
    assert.match(JSON.parse(add.stdout).data.id, /^EV-/);

    const list = await run(['evidence', 'list', '--task', 'T-001', '--dir', dir, '--json']);
    assert.equal(JSON.parse(list.stdout).data.items.length, 1);

    const reindex = await run(['reindex', dir, '--json']);
    assert.equal(reindex.code, 0);

    const guard = await run(['guard', 'commit', '--task', 'T-001', '--staged', '--dir', dir, '--json']);
    assert.equal(guard.code, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('passing evidence unlocks a done report and releases the lease', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-cli-done-'));
  try {
    await run(['init', dir, '--name', 'demo', '--json']);
    await run(['task', 'claim', 'T-001', '--by', 'executor:w1', '--dir', dir, '--json']);
    await run([
      'evidence', 'add', '--task', 'T-001', '--kind', 'test', '--uri', 'npm test',
      '--verdict', 'pass', '--by', 'executor:w1', '--dir', dir, '--json'
    ]);

    const done = await run(['task', 'report', 'T-001', '--state', 'done', '--by', 'executor:w1', '--dir', dir, '--json']);
    assert.equal(done.code, 0);
    assert.equal(JSON.parse(done.stdout).data.task.status, 'done');

    const leases = JSON.parse((await run(['lease', 'status', '--dir', dir, '--json'])).stdout);
    assert.equal(leases.data.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEvidence } from '../src/core/evidence.mjs';
import { claimTask } from '../src/core/mutations.mjs';
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

test('evidence retract works from the project cwd without --dir', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const record = await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'fail', by: 'executor:w1'
    });

    const first = await run(dir, ['evidence', 'retract', record.id, '--by', 'reviewer:p', '--reason', 'repro; fixed', '--json']);
    assert.equal(first.code, 0, first.stderr || first.stdout);

    const second = await run(dir, ['evidence', 'retract', record.id, '--by', 'reviewer:p', '--reason', 'again', '--json']);
    assert.equal(second.code, 3);
    assert.equal(JSON.parse(second.stdout).error.code, 'EVIDENCE_ALREADY_RETRACTED');

    const unknown = await run(dir, ['evidence', 'retract', 'EV-nope', '--by', 'reviewer:p', '--reason', 'x', '--json']);
    assert.equal(unknown.code, 3);
    const body = JSON.parse(unknown.stdout);
    assert.equal(body.error.code, 'EVIDENCE_UNKNOWN');
    assert.equal(body.error.details.shards, 1);
    assert.equal(path.basename(body.error.details.root), path.basename(dir));
  } finally {
    await cleanup(dir);
  }
});

test('an id-shaped positional is not mistaken for a project directory', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await run(dir, ['status', 'T-001', '--json']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).ok, true);
  } finally {
    await cleanup(dir);
  }
});

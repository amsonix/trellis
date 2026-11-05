import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claimTask, reportTask } from '../src/core/mutations.mjs';
import { addEvidence, verifyTaskEvidence } from '../src/core/evidence.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const git = promisify(execFile);
const runGit = (dir, ...args) => git('git', ['-C', dir, ...args]);

test('tree drift only warns for a closure-bound task', async () => {
  const dir = await makeProject('generic');
  try {
    await runGit(dir, 'init', '-q');
    await runGit(dir, 'add', '-A');
    await runGit(dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init');

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
    await runGit(dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--allow-empty', '-qm', 'later');

    const active = await verifyTaskEvidence(dir, 'T-001');
    assert.ok(!active.some((check) => check.code === 'EVIDENCE_TREE_DRIFT'));

    await reportTask(dir, 'T-001', { state: 'done', by: 'executor:w1' });
    const closed = await verifyTaskEvidence(dir, 'T-001');
    assert.ok(closed.some((check) => check.code === 'EVIDENCE_TREE_DRIFT' && check.severity === 'warn'));
  } finally {
    await cleanup(dir);
  }
});

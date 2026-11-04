import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimTask, finishTask } from '../src/core/mutations.mjs';
import { listEvidence, verifyTaskEvidence } from '../src/core/evidence.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const git = (dir, ...args) => execFileAsync('git', ['-C', dir, ...args]);

test('finish runs the command, records evidence and marks done', async () => {
  const dir = await makeProject('generic');
  try {
    const script = path.join(dir, 'ok.mjs');
    await writeFile(script, 'process.exit(0);\n');
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const data = await finishTask(dir, 'T-001', {
      run: `"${process.execPath}" "${script}"`,
      by: 'executor:w1'
    });
    assert.equal(data.exitCode, 0);
    assert.ok(data.log.startsWith('.trellis/logs/'));
    await access(path.join(dir, data.log));
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].status, 'done');
    const items = await listEvidence(dir, 'T-001');
    assert.equal(items.length, 1);
    assert.equal(items[0].verdict, 'pass');
    assert.equal(items[0].commit, null);
  } finally {
    await cleanup(dir);
  }
});

test('a failing command records failing evidence and refuses done', async () => {
  const dir = await makeProject('generic');
  try {
    const script = path.join(dir, 'fail.mjs');
    await writeFile(script, 'process.exit(1);\n');
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await assert.rejects(
      () => finishTask(dir, 'T-001', { run: `"${process.execPath}" "${script}"`, by: 'executor:w1' }),
      (error) => error.code === 'TASK_FINISH_FAILED'
    );
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks[0].status, 'in_progress');
    const items = await listEvidence(dir, 'T-001');
    assert.equal(items[0].verdict, 'fail');
  } finally {
    await cleanup(dir);
  }
});

test('evidence records its commit and verify warns after HEAD moves', async () => {
  const dir = await makeProject('generic');
  try {
    await git(dir, 'init', '-q');
    await git(dir, 'add', '-A');
    await git(dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init');
    const head = (await git(dir, 'rev-parse', 'HEAD')).stdout.trim();
    const script = path.join(dir, 'ok.mjs');
    await writeFile(script, 'process.exit(0);\n');

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const data = await finishTask(dir, 'T-001', { run: `"${process.execPath}" "${path.join(dir, 'ok.mjs')}"`, by: 'executor:w1' });
    assert.equal(data.evidence.commit, head);

    await git(dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--allow-empty', '-qm', 'later');
    const checks = await verifyTaskEvidence(dir, 'T-001');
    assert.ok(checks.some((check) => check.code === 'EVIDENCE_TREE_DRIFT' && check.severity === 'warn'));
  } finally {
    await cleanup(dir);
  }
});

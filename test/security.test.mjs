import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTasks, parseTasks } from '../src/core/tasks.mjs';
import { addTask } from '../src/core/project.mjs';
import { addEvidence } from '../src/core/evidence.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = path.resolve(fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url)));

const task = (overrides = {}) => ({
  id: 'T-001',
  milestone: 'M0',
  title: 'x',
  role: 'executor',
  scope: ['src'],
  dependsOn: [],
  acceptance: 'a',
  verification: 'v',
  status: 'todo',
  priority: 'medium',
  ...overrides
});

test('a wildcard or traversal scope is refused at add time', async () => {
  const dir = await makeProject('generic');
  try {
    for (const scope of ['*', '..', '../../../etc', '/etc', 'src/../../etc']) {
      await assert.rejects(
        () => addTask(dir, { title: 'Bad scope', scope, acceptance: 'a', verification: 'v', by: 'coordinator:kim' }),
        /scope/i,
        scope
      );
    }
  } finally {
    await cleanup(dir);
  }
});

test('an unsafe scope on the board is a validation failure', () => {
  const checks = validateTasks([task({ scope: ['*'] })], { milestones: [{ id: 'M0' }] });
  assert.ok(checks.some((check) => check.code === 'TASK_SCOPE_INVALID' && check.severity === 'fail'));
});

test('evidence cannot point outside the project', async () => {
  const dir = await makeProject('generic');
  try {
    for (const uri of ['../outside.txt', '/etc/passwd', 'docs/../../outside']) {
      await assert.rejects(
        () => addEvidence(dir, { taskId: 'T-001', kind: 'test', uri, verdict: 'pass', by: 'executor:w1' }),
        /inside the project/,
        uri
      );
    }
    const record = await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'https://example.com/ci/1234', verdict: 'pass', by: 'executor:w1'
    });
    assert.equal(record.sha256, null);
  } finally {
    await cleanup(dir);
  }
});

test('overlong titles are refused before the board is written', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => addTask(dir, { title: 'x'.repeat(201), scope: 'docs/x', acceptance: 'a', verification: 'v', by: 'coordinator:kim' }),
      /limit is 200/
    );
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.length, 1);
  } finally {
    await cleanup(dir);
  }
});

test('scope suggest explains that git is required', async () => {
  const dir = await makeProject('generic');
  try {
    let error;
    try {
      await execFileAsync(process.execPath, [bin, 'scope', 'suggest', '--task', 'T-001', '--dir', dir, '--json']);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'expected a non-zero exit');
    assert.equal(error.code, 4);
    assert.match(error.stdout, /UNAVAILABLE/);
    assert.match(error.stdout, /needs a git repository/);
  } finally {
    await cleanup(dir);
  }
});

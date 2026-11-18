import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/core/project.mjs';
import { addTask } from '../src/core/mutations.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { approveGate } from '../src/core/gates.mjs';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

async function blank() {
  return mkdtemp(path.join(os.tmpdir(), 'trellis-bootstrap-'));
}

test('init --empty-tasks starts with no tasks', async () => {
  const dir = await blank();
  try {
    await initProject({ dir, name: 'bootstrap', emptyTasks: true });
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a gated board refuses task add before G2 and allows it after', async () => {
  const dir = await blank();
  try {
    await initProject({ dir, name: 'bootstrap', emptyTasks: true });
    await assert.rejects(
      () => addTask(dir, {
        title: 'too early', scope: 'src/a', acceptance: 'a', verification: 'manual', by: 'coordinator:kim'
      }),
      (error) => error.code === 'TASK_BEFORE_PLAN'
    );

    await approveGate(dir, 'G0', { by: 'human:alice' });
    await approveGate(dir, 'G1', { by: 'architect:ann' });
    await approveGate(dir, 'G2', { by: 'architect:ann' });

    const { task } = await addTask(dir, {
      title: 'planned task', scope: 'src/a', acceptance: 'a', verification: 'manual', by: 'architect:ann'
    });
    assert.equal(task.id, 'T-001');
    assert.equal((await parseTasks(dir)).tasks.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('init --empty-tasks is exposed through the CLI', async () => {
  const dir = await blank();
  try {
    const result = await execFileAsync(process.execPath, [bin, 'init', dir, '--name', 'cli-bootstrap', '--empty-tasks', '--json']);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.equal((await parseTasks(dir)).tasks.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

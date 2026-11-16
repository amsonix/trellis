import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { planCoverage } from '../src/core/coverage.mjs';
import { addTask, claimTask, editTask } from '../src/core/mutations.mjs';
import { projectStatus, taskShow } from '../src/core/project.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

test('coverage maps ROADMAP exit criteria through Source', async () => {
  const dir = await makeProject('generic');
  try {
    let coverage = await planCoverage(dir);
    const m0 = coverage.milestones.find((item) => item.id === 'M0');
    assert.equal(m0.criteria.length, 3);
    assert.equal(m0.criteria[0].covered, true);
    assert.deepEqual(m0.criteria[0].tasks, ['T-001']);
    assert.deepEqual(m0.uncovered, [2, 3]);

    await addTask(dir, {
      title: 'Exit two', scope: 'docs/b', acceptance: 'b', verification: 'manual',
      source: 'ROADMAP#M0/exit-2', by: 'architect:ann'
    });
    coverage = await planCoverage(dir);
    const updated = coverage.milestones.find((item) => item.id === 'M0');
    assert.equal(updated.criteria[1].covered, true);
    assert.deepEqual(updated.uncovered, [3]);

    await addTask(dir, {
      title: 'Whole milestone', scope: 'docs/c', acceptance: 'c', verification: 'manual',
      source: 'ROADMAP#M0', by: 'architect:ann'
    });
    coverage = await planCoverage(dir);
    assert.deepEqual(coverage.milestones.find((item) => item.id === 'M0').uncovered, []);
  } finally {
    await cleanup(dir);
  }
});

test('an invalid source is refused', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => addTask(dir, {
        title: 'Bad source', scope: 'docs/b', acceptance: 'b', verification: 'manual',
        source: 'ROADMAP#M0/exit-9', by: 'architect:ann'
      }),
      (error) => error.code === 'TASK_INVALID'
    );
    await assert.rejects(
      () => addTask(dir, {
        title: 'Bad artifact', scope: 'docs/c', acceptance: 'c', verification: 'manual',
        source: 'NOPE#section', by: 'architect:ann'
      }),
      (error) => error.code === 'TASK_INVALID'
    );
  } finally {
    await cleanup(dir);
  }
});

test('status reports uncovered criteria for an active milestone', async () => {
  const dir = await makeProject('generic');
  try {
    const status = await projectStatus(dir);
    assert.ok(status.attention.some((item) => item.code === 'MILESTONE_UNCOVERED' && item.milestone === 'M0'));
  } finally {
    await cleanup(dir);
  }
});

test('plan coverage is exposed through the CLI and --strict fails on gaps', async () => {
  const dir = await makeProject('generic');
  try {
    const json = await execFileAsync(process.execPath, [bin, 'plan', 'coverage', '--json'], { cwd: dir });
    const data = JSON.parse(json.stdout).data;
    assert.ok(data.totals.uncovered > 0);

    let strict;
    try {
      await execFileAsync(process.execPath, [bin, 'plan', 'coverage', '--strict'], { cwd: dir });
      strict = 0;
    } catch (error) {
      strict = error.code;
    }
    assert.equal(strict, 3);
  } finally {
    await cleanup(dir);
  }
});

test('a child inherits its parent source and is not an orphan', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'Child', scope: 'src/child', acceptance: 'child', verification: 'manual',
      parent: 'T-001', by: 'architect:ann'
    });
    const { tasks } = await parseTasks(dir);
    const child = tasks.find((task) => task.id === 'T-002');
    assert.equal(child.source, 'ROADMAP#M0/exit-1');

    const coverage = await planCoverage(dir);
    const m0 = coverage.milestones.find((item) => item.id === 'M0');
    assert.deepEqual(m0.criteria[0].tasks, ['T-001', 'T-002']);
    assert.deepEqual(m0.orphans, []);
    assert.equal(coverage.totals.orphanTasks, 0);

    const shown = await taskShow(dir, 'T-002', { context: true });
    assert.equal(shown.effectiveSource, 'ROADMAP#M0/exit-1');
  } finally {
    await cleanup(dir);
  }
});

test('a follow-up does not inherit the parent source', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addTask(dir, {
      title: 'Follow-up', scope: 'src/child', acceptance: 'follow', verification: 'manual',
      followUpOf: 'T-001', by: 'architect:ann'
    });
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.find((task) => task.id === 'T-002').source, null);
  } finally {
    await cleanup(dir);
  }
});

test('attaching an existing task to a parent inherits the source', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, {
      title: 'Loose', scope: 'src/child', acceptance: 'loose', verification: 'manual',
      parent: 'T-001', source: '-', by: 'architect:ann'
    });
    await editTask(dir, 'T-002', { parent: 'T-001', by: 'architect:ann' });
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.find((task) => task.id === 'T-002').source, 'ROADMAP#M0/exit-1');
  } finally {
    await cleanup(dir);
  }
});

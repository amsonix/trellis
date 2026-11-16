import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { planCoverage } from '../src/core/coverage.mjs';
import { addTask } from '../src/core/mutations.mjs';
import { projectStatus } from '../src/core/project.mjs';
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

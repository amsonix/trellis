import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject, projectStatus, runChecks } from '../src/core/project.mjs';
import { loadState } from '../src/core/store.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('init creates the artifact set and a pending gate ledger', async () => {
  const dir = await makeProject('web-app');
  try {
    const state = await loadState(dir);
    assert.equal(state.project.profile, 'web-app');
    assert.equal(state.gates.G0.status, 'pending');
    const checks = await runChecks(dir);
    assert.equal(checks.summary.fail, 0);
    assert.equal(checks.summary.unavailable, 0);
    assert.ok(checks.checks.some((check) => check.code === 'ARTIFACT_OK'));
    assert.ok(checks.checks.some((check) => check.code === 'TASKS_VALID'));
    const status = await projectStatus(dir);
    assert.equal(status.stage, 'intake');
    assert.equal(status.tasks.total, 1);
  } finally {
    await cleanup(dir);
  }
});

test('init refuses a non-empty directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-nonempty-'));
  try {
    await writeFile(path.join(dir, 'keep.txt'), 'do not overwrite');
    await assert.rejects(
      () => initProject({ dir, name: 'x', profile: 'web-app' }),
      (error) => error.code === 'DIR_NOT_EMPTY'
    );
  } finally {
    await cleanup(dir);
  }
});

test('library profile does not require OPERATIONS', async () => {
  const dir = await makeProject('library');
  try {
    const state = await loadState(dir);
    assert.equal(state.project.profile, 'library');
    const checks = await runChecks(dir);
    assert.equal(checks.summary.fail, 0);
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

test('init on an existing project preserves files and creates .trellis', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-existing-'));
  try {
    await writeFile(path.join(dir, 'README.md'), 'do not overwrite');
    await writeFile(path.join(dir, 'TASKS.md'), 'legacy board');
    const result = await initProject({ dir, name: 'existing', profile: 'generic' });
    assert.equal(result.managementDir, path.join(dir, '.trellis'));
    assert.equal(await readFile(path.join(dir, 'README.md'), 'utf8'), 'do not overwrite');
    assert.equal(await readFile(path.join(dir, 'TASKS.md'), 'utf8'), 'legacy board');
    await access(path.join(dir, '.trellis/PROJECT.md'));
    await access(path.join(dir, '.trellis/docs/TASKS.md'));
    await assert.rejects(
      () => initProject({ dir, name: 'existing', profile: 'generic' }),
      (error) => error.code === 'ALREADY_INITIALIZED'
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

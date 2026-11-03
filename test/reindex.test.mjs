import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { reindex, projectStatus } from '../src/core/project.mjs';
import { cleanup, makeProject, replace } from './helpers.mjs';

test('reindex rebuilds the state from the artifacts', async () => {
  const dir = await makeProject();
  try {
    await rm(path.join(dir, '.project-protocol/state.json'));
    const result = await reindex(dir);
    assert.equal(result.project.name, 'test-project');
    assert.equal(result.stage, 'intake');
    const status = await projectStatus(dir);
    assert.equal(status.gates.G0.status, 'pending');
  } finally {
    await cleanup(dir);
  }
});

test('reindex follows the project front-matter', async () => {
  const dir = await makeProject();
  try {
    await replace(dir, '.project-protocol/PROJECT.md', 'project: test-project', 'project: renamed-project');
    const result = await reindex(dir);
    assert.equal(result.project.name, 'renamed-project');
    const status = await projectStatus(dir);
    assert.equal(status.project.name, 'renamed-project');
  } finally {
    await cleanup(dir);
  }
});

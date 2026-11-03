import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/core/project.mjs';
import { cleanup, makeProject, replace } from './helpers.mjs';

test('a missing required section is a failure', async () => {
  const dir = await makeProject();
  try {
    await replace(dir, '.trellis/PROJECT.md', '## Acceptance', '## Acceptance removed');
    const checks = await runChecks(dir);
    assert.ok(checks.checks.some((check) => check.code === 'SECTION_MISSING' && check.section === 'Acceptance'));
    assert.equal(checks.exitCode, 3);
  } finally {
    await cleanup(dir);
  }
});

test('ARCHITECTURE.md needs a Containers table with the three columns', async () => {
  const dir = await makeProject();
  try {
    await replace(dir, '.trellis/docs/ARCHITECTURE.md', '| Container | Responsibility | Interface |', '| Name | Notes | Owner |');
    const checks = await runChecks(dir);
    assert.ok(checks.checks.some((check) => check.code === 'CONTAINERS_TABLE_INVALID'));
    assert.equal(checks.exitCode, 3);
  } finally {
    await cleanup(dir);
  }
});

test('every milestone needs an exit criterion', async () => {
  const dir = await makeProject();
  try {
    await replace(dir, '.trellis/docs/ROADMAP.md', 'Exit criteria:', 'Done when:');
    const checks = await runChecks(dir);
    assert.ok(checks.checks.some((check) => check.code === 'MILESTONE_EXIT_MISSING'));
    assert.equal(checks.exitCode, 3);
  } finally {
    await cleanup(dir);
  }
});

test('a missing front-matter block is a failure', async () => {
  const dir = await makeProject();
  try {
    await replace(dir, '.trellis/docs/RESEARCH.md', /---[\s\S]*?---\n/, '');
    const checks = await runChecks(dir);
    assert.ok(checks.checks.some((check) => check.code === 'FRONTMATTER_MISSING'));
  } finally {
    await cleanup(dir);
  }
});

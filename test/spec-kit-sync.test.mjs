import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecTasks, syncTasks } from '../examples/spec-kit/sync.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const sample = [
  '## Phase 1',
  '- [ ] T001 [P] Add the parser',
  '- [x] T002 Already shipped',
  '- [ ] T003 Add the CLI',
  'not a task line'
].join('\n');

test('the Spec Kit parser reads open items and skips completed ones', () => {
  const tasks = parseSpecTasks(sample);
  assert.deepEqual(tasks, [
    { id: 'T001', title: 'Add the parser', done: false },
    { id: 'T002', title: 'Already shipped', done: true },
    { id: 'T003', title: 'Add the CLI', done: false }
  ]);
});

test('sync creates one task per open item and is idempotent', async () => {
  const dir = await makeProject('generic');
  try {
    const first = await syncTasks(dir, sample, { scope: 'docs/spec', by: 'coordinator:spec-kit' });
    assert.equal(first.created.length, 2);
    assert.equal(first.skipped.length, 0);

    const { tasks } = await parseTasks(dir);
    const titles = tasks.map((task) => task.title);
    assert.ok(titles.includes('[T001] Add the parser'));
    assert.ok(titles.includes('[T003] Add the CLI'));
    assert.ok(!titles.includes('[T002] Already shipped'));
    assert.deepEqual(tasks.at(-1).dependsOn, [tasks.at(-2).id]);

    const second = await syncTasks(dir, sample, { scope: 'docs/spec', by: 'coordinator:spec-kit' });
    assert.equal(second.created.length, 0);
    assert.deepEqual(second.skipped, ['T001', 'T003']);
  } finally {
    await cleanup(dir);
  }
});

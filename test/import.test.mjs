import test from 'node:test';
import assert from 'node:assert/strict';
import { addTasks } from '../src/core/mutations.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('task add --from imports a JSON array with dependencies', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await addTasks(dir, [
      { title: 'Import A', scope: 'docs/a', acceptance: 'A works', verification: 'npm test', priority: 'high' },
      { title: 'Import B', scope: 'docs/b', acceptance: 'B works', verification: 'npm test', dependsOn: ['T-002'] }
    ], { by: 'architect:ann' });
    assert.equal(result.count, 2);
    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.length, 3);
    assert.equal(tasks[2].id, 'T-003');
    assert.deepEqual(tasks[2].dependsOn, ['T-002']);
  } finally {
    await cleanup(dir);
  }
});

test('an empty import is refused', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(() => addTasks(dir, [], { by: 'architect:ann' }), (error) => error.code === 'USAGE');
  } finally {
    await cleanup(dir);
  }
});

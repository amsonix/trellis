import test from 'node:test';
import assert from 'node:assert/strict';
import { approveGate } from '../src/core/gates.mjs';
import { addTask } from '../src/core/mutations.mjs';
import { nextAction } from '../src/core/project.mjs';
import { covers } from '../src/core/util.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function plan(dir) {
  for (const [gate, by] of [
    ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
    ['G3', 'human:alice'], ['G4', 'coordinator:kim']
  ]) await approveGate(dir, gate, { by });
}

test('next --batch returns a priority-ordered scope-disjoint batch with why', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, { title: 'High', scope: 'docs/a', acceptance: 'a', verification: 'manual', priority: 'high', by: 'architect:ann' });
    await addTask(dir, { title: 'Low', scope: 'docs/b', acceptance: 'b', verification: 'manual', priority: 'low', by: 'architect:ann' });
    await addTask(dir, { title: 'Later', scope: 'docs/c', acceptance: 'c', verification: 'manual', dependsOn: ['T-002'], by: 'architect:ann' });
    await plan(dir);

    const result = await nextAction(dir, 'executor', { batch: 2 });
    assert.equal(result.kind, 'tasks');
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].id, 'T-002');
    assert.match(result.tasks[0].why, /high priority/);
    const scopes = result.tasks.flatMap((task) => task.scope);
    for (let i = 0; i < result.tasks.length; i += 1) {
      for (const a of result.tasks[i].scope) {
        for (const b of scopes.slice(scopes.indexOf(a) + 1)) {
          assert.ok(!covers(a, b) && !covers(b, a), `${a} overlaps ${b}`);
        }
      }
    }
  } finally {
    await cleanup(dir);
  }
});

test('next --batch --strategy unblock prefers a task that unblocks others', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, { title: 'High alone', scope: 'docs/a', acceptance: 'a', verification: 'manual', priority: 'high', by: 'architect:ann' });
    await addTask(dir, { title: 'Blocker', scope: 'docs/b', acceptance: 'b', verification: 'manual', priority: 'low', by: 'architect:ann' });
    await addTask(dir, { title: 'Waits', scope: 'docs/c', acceptance: 'c', verification: 'manual', dependsOn: ['T-003'], by: 'architect:ann' });
    await plan(dir);

    const result = await nextAction(dir, 'executor', { batch: 1, strategy: 'unblock' });
    assert.equal(result.tasks[0].id, 'T-003');
    assert.match(result.tasks[0].why, /unblocks 1/);
  } finally {
    await cleanup(dir);
  }
});

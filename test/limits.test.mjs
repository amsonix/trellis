import test from 'node:test';
import assert from 'node:assert/strict';
import { approveGate } from '../src/core/gates.mjs';
import { addTask, nextAction } from '../src/core/project.mjs';
import { claimTask, releaseLease } from '../src/core/mutations.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function approveAll(dir) {
  for (const [gate, by] of [
    ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
    ['G3', 'human:alice'], ['G4', 'coordinator:kim']
  ]) {
    await approveGate(dir, gate, { by });
  }
}

test('TRELLIS_MAX_LEASES caps one actor but not others', async () => {
  const dir = await makeProject('generic');
  const previous = process.env.TRELLIS_MAX_LEASES;
  try {
    process.env.TRELLIS_MAX_LEASES = '2';
    for (const [title, scope] of [['A', 'docs/a'], ['B', 'docs/b'], ['C', 'docs/c']]) {
      await addTask(dir, { title, scope, acceptance: 'a', verification: 'v', by: 'coordinator:kim' });
    }
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await claimTask(dir, 'T-002', { by: 'executor:w1' });
    await assert.rejects(
      () => claimTask(dir, 'T-003', { by: 'executor:w1' }),
      (error) => error.code === 'LEASE_LIMIT'
    );

    // another actor is not affected
    await claimTask(dir, 'T-003', { by: 'executor:w2' });

    await releaseLease(dir, 'T-001', 'coordinator:kim');
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
  } finally {
    if (previous === undefined) delete process.env.TRELLIS_MAX_LEASES;
    else process.env.TRELLIS_MAX_LEASES = previous;
    await cleanup(dir);
  }
});

test('next --limit returns at most N tasks', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, { title: 'A', scope: 'docs/a', acceptance: 'a', verification: 'v', by: 'coordinator:kim' });
    await addTask(dir, { title: 'B', scope: 'docs/b', acceptance: 'a', verification: 'v', by: 'coordinator:kim' });
    await approveAll(dir);

    const all = await nextAction(dir, 'executor');
    assert.equal(all.tasks.length, 3);

    const limited = await nextAction(dir, 'executor', { limit: 1 });
    assert.equal(limited.tasks.length, 1);
  } finally {
    await cleanup(dir);
  }
});

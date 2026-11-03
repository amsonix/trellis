import test from 'node:test';
import assert from 'node:assert/strict';
import { claimTask } from '../src/core/project.mjs';
import { acquireLease, guardCommit, leaseStatus, releaseLease } from '../src/core/lease.mjs';
import { cleanup, makeProject, appendTask, read } from './helpers.mjs';

test('two tasks cannot hold overlapping leases', async () => {
  const dir = await makeProject();
  try {
    await appendTask(
      dir,
      '| T-002 | M0 | Second task | executor | src | - | Build passes | `npm test` | todo |'
    );
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await assert.rejects(
      () => acquireLease(dir, { taskId: 'T-002', actor: 'executor:worker-2', domains: ['src'] }),
      (error) => error.code === 'LEASE_CONFLICT'
    );
    assert.equal((await leaseStatus(dir)).length, 1);
  } finally {
    await cleanup(dir);
  }
});

test('the commit guard blocks out-of-scope and foreign paths', async () => {
  const dir = await makeProject();
  try {
    await appendTask(
      dir,
      '| T-002 | M0 | Docs task | executor | docs | - | Docs build | `npm run docs` | todo |'
    );
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await acquireLease(dir, { taskId: 'T-002', actor: 'executor:worker-2', domains: ['docs'] });

    const good = await guardCommit(dir, { taskId: 'T-001', stagedPaths: ['src/index.js'] });
    assert.equal(good.ok, true);

    const outOfScope = await guardCommit(dir, { taskId: 'T-001', stagedPaths: ['docs/guide.md'] });
    assert.equal(outOfScope.ok, false);
    assert.ok(outOfScope.violations.some((violation) => violation.code === 'OUT_OF_SCOPE'));
    assert.ok(outOfScope.violations.some((violation) => violation.code === 'FOREIGN_LEASE'));

    const observed = await guardCommit(dir, { taskId: 'T-001', stagedPaths: ['docs/guide.md'], observe: true });
    assert.equal(observed.ok, true);
    assert.equal(observed.observed, true);
    assert.ok(observed.violations.length > 0);
  } finally {
    await cleanup(dir);
  }
});

test('a released lease frees its domain for the next task', async () => {
  const dir = await makeProject();
  try {
    await appendTask(
      dir,
      '| T-002 | M0 | Second task | executor | src | - | Build passes | `npm test` | todo |'
    );
    await claimTask(dir, 'T-001', { by: 'executor:worker-1' });
    await assert.rejects(
      () => acquireLease(dir, { taskId: 'T-002', actor: 'executor:worker-2', domains: ['src'] }),
      (error) => error.code === 'LEASE_CONFLICT'
    );

    assert.equal(await releaseLease(dir, 'T-001', 'coordinator:lead'), true);
    const lease = await acquireLease(dir, { taskId: 'T-002', actor: 'executor:worker-2', domains: ['src'] });
    assert.equal(lease.taskId, 'T-002');

    const ledger = JSON.parse(await read(dir, '.trellis/leases.json'));
    const released = ledger.items.find((item) => item.taskId === 'T-001');
    assert.equal(released.state, 'released');
    assert.equal(released.releasedBy, 'coordinator:lead');

    // negative control: releasing an already released lease changes nothing
    assert.equal(await releaseLease(dir, 'T-001', 'coordinator:lead'), false);
  } finally {
    await cleanup(dir);
  }
});

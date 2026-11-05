import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimTask, reapLeases } from '../src/core/mutations.mjs';
import { leaseStatus } from '../src/core/lease.mjs';
import { addTask } from '../src/core/mutations.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a claim can lease a subset of the task scope', async () => {
  const dir = await makeProject('generic');
  try {
    const { lease } = await claimTask(dir, 'T-001', { by: 'executor:w1', paths: 'README.md' });
    assert.deepEqual(lease.domains, ['README.md']);
    await addTask(dir, {
      title: 'Second', scope: 'docs/b', acceptance: 'b', verification: 'npm test', by: 'architect:ann'
    });
    const second = await claimTask(dir, 'T-002', { by: 'executor:w2' });
    assert.deepEqual(second.lease.domains, ['docs/b']);
  } finally {
    await cleanup(dir);
  }
});

test('a path outside the task scope is refused', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w1', paths: 'docs/nope.md' }),
      (error) => error.code === 'LEASE_OUT_OF_SCOPE'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a glob in the board scope is refused at claim time', async () => {
  const dir = await makeProject('generic');
  try {
    const file = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('| src, test, package.json, README.md |', '| bench/results/t113-*.md |'));
    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w1' }),
      (error) => error.code === 'TASK_SCOPE_INVALID'
    );
  } finally {
    await cleanup(dir);
  }
});

test('lease reap releases leases older than the threshold', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    const file = path.join(dir, '.trellis/leases.json');
    const ledger = JSON.parse(await readFile(file, 'utf8'));
    ledger.items[0].createdAt = '2020-01-01T00:00:00.000Z';
    await writeFile(file, JSON.stringify(ledger));
    const result = await reapLeases(dir, { by: 'human:alice', olderThanHours: 1 });
    assert.deepEqual(result.released, ['T-001']);
    assert.equal((await leaseStatus(dir)).length, 0);
  } finally {
    await cleanup(dir);
  }
});

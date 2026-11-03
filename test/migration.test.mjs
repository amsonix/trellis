import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listEvidence } from '../src/core/evidence.mjs';
import { leaseStatus } from '../src/core/lease.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

test('legacy evidence.json is migrated into the jsonl log', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(
      path.join(dir, '.trellis/evidence.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        items: [
          {
            id: 'EV-legacy',
            taskId: 'T-001',
            kind: 'test',
            uri: 'npm test',
            sha256: null,
            verdict: 'pass',
            producedBy: 'executor:w1',
            producedAt: '2026-11-03T00:00:00.000Z',
            note: null
          }
        ]
      })}\n`
    );

    const items = await listEvidence(dir);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'EV-legacy');
    assert.equal(items[0].retracted, null);

    await assert.rejects(() => access(path.join(dir, '.trellis/evidence.json')));
    const log = (await readFile(path.join(dir, '.trellis/evidence.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(JSON.parse(log[0]).type, 'add');
  } finally {
    await cleanup(dir);
  }
});

test('released leases in a legacy file move to the archive', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(
      path.join(dir, '.trellis/leases.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        items: [
          { id: 'L-1', taskId: 'T-001', actor: 'executor:w1', domains: ['src'], state: 'held', createdAt: '2026-11-03T00:00:00.000Z', releasedAt: null },
          { id: 'L-2', taskId: 'T-002', actor: 'executor:w2', domains: ['docs'], state: 'released', createdAt: '2026-11-02T00:00:00.000Z', releasedAt: '2026-11-02T01:00:00.000Z' }
        ]
      })}\n`
    );

    const held = await leaseStatus(dir);
    assert.deepEqual(held.map((lease) => lease.taskId), ['T-001']);

    const active = await readJson(path.join(dir, '.trellis/leases.json'));
    assert.equal(active.items.length, 1);

    const archive = (await readFile(path.join(dir, '.trellis/leases.archive.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(archive.map((lease) => lease.id), ['L-2']);
  } finally {
    await cleanup(dir);
  }
});

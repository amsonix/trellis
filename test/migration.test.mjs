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
    const log = (await readFile(path.join(dir, '.trellis/evidence/T-001.jsonl'), 'utf8')).trim().split('\n');
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


test('a legacy jsonl log migrates into per-task shards', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(
      path.join(dir, '.trellis/evidence.jsonl'),
      [
        JSON.stringify({ type: 'add', id: 'EV-a', taskId: 'T-001', kind: 'test', uri: 'a', verdict: 'pass', producedBy: 'executor:w1', producedAt: '2026-01-01T00:00:00.000Z' }),
        JSON.stringify({ type: 'add', id: 'EV-b', taskId: 'T-002', kind: 'test', uri: 'b', verdict: 'pass', producedBy: 'executor:w1', producedAt: '2026-01-01T00:00:00.000Z' }),
        JSON.stringify({ type: 'retract', id: 'EV-a', by: 'reviewer:rita', at: '2026-01-02T00:00:00.000Z', reason: 'wrong' })
      ].join('\n') + '\n'
    );

    const items = await listEvidence(dir);
    assert.equal(items.length, 2);
    assert.ok(items.find((item) => item.id === 'EV-a').retracted);
    assert.equal(items.find((item) => item.id === 'EV-b').retracted, null);

    await assert.rejects(() => access(path.join(dir, '.trellis/evidence.jsonl')));
    await access(path.join(dir, '.trellis/evidence.jsonl.migrated'));
    await access(path.join(dir, '.trellis/evidence/T-001.jsonl'));
    await access(path.join(dir, '.trellis/evidence/T-002.jsonl'));
  } finally {
    await cleanup(dir);
  }
});

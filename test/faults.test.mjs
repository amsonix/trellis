import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claimTask } from '../src/core/mutations.mjs';
import { listEvidence } from '../src/core/evidence.mjs';
import { doctor } from '../src/core/doctor.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a corrupt state is reported, not thrown by doctor', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(path.join(dir, '.trellis/state.json'), '{not json');
    const result = await doctor(dir);
    assert.ok(result.checks.some((check) => check.code === 'STATE_BROKEN' && check.severity === 'fail'));
  } finally {
    await cleanup(dir);
  }
});

test('a corrupt lease ledger is reported by doctor', async () => {
  const dir = await makeProject('generic');
  try {
    await writeFile(path.join(dir, '.trellis/leases.json'), '{"items": "nope"}');
    const result = await doctor(dir);
    assert.ok(result.checks.some((check) => check.code === 'LEASES_BROKEN'));
  } finally {
    await cleanup(dir);
  }
});

test('a read-only .trellis refuses writes without corrupting state', { skip: process.platform === 'win32' }, async () => {
  const dir = await makeProject('generic');
  const meta = path.join(dir, '.trellis');
  try {
    await chmod(meta, 0o555);
    await assert.rejects(() => claimTask(dir, 'T-001', { by: 'executor:w1' }));
  } finally {
    await chmod(meta, 0o755).catch(() => {});
    const state = JSON.parse(await readFile(path.join(meta, 'state.json'), 'utf8'));
    assert.equal(state.schemaVersion, 3);
    await cleanup(dir);
  }
});

test('re-running the legacy migration is idempotent', async () => {
  const dir = await makeProject('generic');
  try {
    const shard = path.join(dir, '.trellis/evidence/T-001.jsonl');
    await mkdir(path.dirname(shard), { recursive: true });
    await writeFile(
      path.join(dir, '.trellis/evidence.jsonl'),
      `${JSON.stringify({ type: 'add', id: 'EV-old', taskId: 'T-001', kind: 'test', uri: 'old', verdict: 'pass', producedBy: 'executor:w1', producedAt: '2026-01-01T00:00:00.000Z' })}\n`
    );
    await writeFile(
      shard,
      `${JSON.stringify({ type: 'add', id: 'EV-new', taskId: 'T-001', kind: 'test', uri: 'new', verdict: 'pass', producedBy: 'executor:w1', producedAt: '2026-01-02T00:00:00.000Z' })}\n`
    );

    const first = await listEvidence(dir);
    const second = await listEvidence(dir);
    assert.deepEqual(first.map((item) => item.id).sort(), ['EV-new', 'EV-old']);
    assert.deepEqual(second.map((item) => item.id).sort(), ['EV-new', 'EV-old']);
  } finally {
    await cleanup(dir);
  }
});

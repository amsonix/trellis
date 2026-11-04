import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compact } from '../src/core/compact.mjs';
import { listEvidence, verifyTaskEvidence } from '../src/core/evidence.mjs';
import { addTaskEvidence, claimTask } from '../src/core/mutations.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const evidenceLines = async (dir) =>
  (await readFile(path.join(dir, '.trellis/evidence/T-001.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

async function seedTrace(dir) {
  await claimTask(dir, 'T-001', { by: 'executor:w1' });
  const failing = await addTaskEvidence(dir, {
    taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'fail', by: 'executor:w1'
  });
  const { retractEvidence } = await import('../src/core/evidence.mjs');
  await retractEvidence(dir, failing.id, { by: 'reviewer:rita', reason: 'fixed' });
  await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
  return failing.id;
}

test('compaction folds events without changing the evidence state', async () => {
  const dir = await makeProject('generic');
  try {
    const retractedId = await seedTrace(dir);
    assert.equal((await evidenceLines(dir)).length, 3);

    const result = await compact(dir);
    assert.equal(result.evidence.before.lines, 3);
    assert.equal(result.evidence.after.lines, 2);

    const items = await listEvidence(dir);
    assert.equal(items.length, 2);
    assert.ok(items.find((item) => item.id === retractedId).retracted);
    assert.equal((await verifyTaskEvidence(dir, 'T-001')).some((check) => check.code === 'EVIDENCE_FAIL'), false);

    const again = await compact(dir);
    assert.equal(again.evidence.before.lines, 2);
    assert.equal(again.evidence.after.lines, 2);
  } finally {
    await cleanup(dir);
  }
});

test('dry run reports sizes without touching the log', async () => {
  const dir = await makeProject('generic');
  try {
    await seedTrace(dir);
    const before = await readFile(path.join(dir, '.trellis/evidence/T-001.jsonl'), 'utf8');
    const result = await compact(dir, { dryRun: true });
    assert.equal(result.evidence.dryRun, true);
    assert.equal(await readFile(path.join(dir, '.trellis/evidence/T-001.jsonl'), 'utf8'), before);
  } finally {
    await cleanup(dir);
  }
});

test('retracted evidence older than the cutoff is archived', async () => {
  const dir = await makeProject('generic');
  try {
    const retractedId = await seedTrace(dir);
    const file = path.join(dir, '.trellis/evidence/T-001.jsonl');
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    for (const line of lines) {
      if (line.type === 'add' && line.id === retractedId) line.producedAt = '2020-01-01T00:00:00.000Z';
    }
    await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    const result = await compact(dir, { archiveRetractedDays: 30 });
    assert.equal(result.evidence.archived, 1);

    const active = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(active.length, 1);
    assert.equal(active[0].verdict, 'pass');

    const archive = (await readFile(path.join(dir, '.trellis/evidence/archive/T-001.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(archive.length, 1);
    assert.equal(archive[0].id, retractedId);

    assert.equal((await verifyTaskEvidence(dir, 'T-001')).some((check) => check.code === 'EVIDENCE_FAIL'), false);
  } finally {
    await cleanup(dir);
  }
});

test('dry run does not archive retracted evidence', async () => {
  const dir = await makeProject('generic');
  try {
    const retractedId = await seedTrace(dir);
    const file = path.join(dir, '.trellis/evidence/T-001.jsonl');
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    for (const line of lines) {
      if (line.type === 'add' && line.id === retractedId) line.producedAt = '2020-01-01T00:00:00.000Z';
    }
    await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    await compact(dir, { archiveRetractedDays: 30, dryRun: true });
    await assert.rejects(() => access(path.join(dir, '.trellis/evidence/archive/T-001.jsonl')));
  } finally {
    await cleanup(dir);
  }
});

test('a large audit stream is rotated', async () => {
  const dir = await makeProject('generic');
  try {
    const audit = path.join(dir, '.trellis/audit.jsonl');
    await writeFile(audit, `${'x'.repeat(500)}\n`);
    const result = await compact(dir, { maxBytes: 100 });
    assert.ok(result.audit);
    await assert.rejects(() => access(audit));
    await access(path.join(dir, '.trellis', path.basename(result.audit.to)));
  } finally {
    await cleanup(dir);
  }
});

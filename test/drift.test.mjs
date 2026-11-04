import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { approveGate } from '../src/core/gates.mjs';
import { claimTask } from '../src/core/mutations.mjs';
import { nextAction, projectStatus, runChecks } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function approvePlan(dir) {
  for (const [gate, by] of [
    ['G0', 'human:alice'], ['G1', 'architect:ann'], ['G2', 'architect:ann'],
    ['G3', 'human:alice'], ['G4', 'coordinator:kim']
  ]) {
    await approveGate(dir, gate, { by });
  }
}

test('an invalid status surfaces in next and claim instead of disappearing', async () => {
  const dir = await makeProject('generic');
  try {
    const file = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('| todo | medium |', '| 部分完成 | medium |'));

    const next = await nextAction(dir, 'executor');
    assert.equal(next.kind, 'waiting');
    assert.equal(next.needsUser, true);
    assert.ok(next.attention.some((item) => item.code === 'TASK_STATUS_INVALID'));

    await assert.rejects(
      () => claimTask(dir, 'T-001', { by: 'executor:w1' }),
      (error) => error.code === 'TASK_STATUS_INVALID'
    );
  } finally {
    await cleanup(dir);
  }
});

test('a prose note is content drift, a bullet is a structural change', async () => {
  const dir = await makeProject('generic');
  try {
    await approvePlan(dir);
    const roadmap = path.join(dir, '.trellis/docs/ROADMAP.md');

    await appendFile(roadmap, '\nA later note about sources.\n');
    const drifted = await projectStatus(dir);
    assert.deepEqual(drifted.staleGates, []);
    assert.ok(drifted.driftedGates.some((item) => item.gate === 'G3'));
    const checks = await runChecks(dir);
    assert.ok(checks.checks.some((check) => check.code === 'GATE_CONTENT_DRIFT' && check.severity === 'warn'));

    await appendFile(roadmap, '- [ ] A new exit criterion.\n');
    const stale = await projectStatus(dir);
    assert.ok(stale.staleGates.some((item) => item.gate === 'G3'));
  } finally {
    await cleanup(dir);
  }
});

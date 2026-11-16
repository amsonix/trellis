import test from 'node:test';
import assert from 'node:assert/strict';
import { closeMilestone, getMilestone, listMilestones, reopenMilestone } from '../src/core/milestones.mjs';
import { listAdrs, setAdrStatus } from '../src/core/adr.mjs';
import { listDocs, showDoc } from '../src/core/docs.mjs';
import { createAdr } from '../src/core/docs.mjs';
import { addEvidence } from '../src/core/evidence.mjs';
import { claimTask, reportTask } from '../src/core/mutations.mjs';
import { projectStatus } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function finish(dir, id) {
  await claimTask(dir, id, { by: 'executor:w1' });
  await addEvidence(dir, { taskId: id, kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1' });
  await reportTask(dir, id, { state: 'done', by: 'executor:w1' });
}

test('milestones expose computed and declared status separately', async () => {
  const dir = await makeProject('generic');
  try {
    let [m0] = await listMilestones(dir);
    assert.equal(m0.computed, 'todo');
    assert.equal(m0.declared, 'planned');

    await finish(dir, 'T-001');
    [m0] = await listMilestones(dir);
    assert.equal(m0.computed, 'done');
    assert.equal(m0.ready, true);

    const status = await projectStatus(dir);
    assert.ok(status.attention.some((item) => item.code === 'MILESTONE_READY' && item.milestone === 'M0'));

    await closeMilestone(dir, 'M0', { by: 'coordinator:kim', note: 'exit criteria checked' });
    m0 = await getMilestone(dir, 'M0');
    assert.equal(m0.declared, 'done');
    assert.equal(m0.ready, false);

    await reopenMilestone(dir, 'M0', { by: 'coordinator:kim', note: 'regressed' });
    assert.equal((await getMilestone(dir, 'M0')).declared, 'active');
  } finally {
    await cleanup(dir);
  }
});

test('closing a milestone with open tasks is refused', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => closeMilestone(dir, 'M0', { by: 'coordinator:kim', note: 'too early' }),
      (error) => error.code === 'MILESTONE_OPEN_TASKS'
    );
  } finally {
    await cleanup(dir);
  }
});

test('ADRs expose and transition their Status section', async () => {
  const dir = await makeProject('generic');
  try {
    const created = await createAdr(dir, { title: 'Second decision', status: 'proposed', by: 'architect:ann' });
    let { items } = await listAdrs(dir);
    const second = items.find((item) => item.file === created.path.split('/').pop());
    assert.equal(second.status, 'proposed');

    const accepted = await setAdrStatus(dir, created.number, 'accepted', { by: 'architect:ann' });
    assert.equal(accepted.status, 'accepted');

    const superseded = await setAdrStatus(dir, created.number, 'superseded', { by: 'human:alice', note: 'replaced' });
    assert.equal(superseded.status, 'superseded');
    await assert.rejects(
      () => setAdrStatus(dir, created.number, 'accepted', { by: 'architect:ann' }),
      (error) => error.code === 'ADR_TERMINAL'
    );
    ({ items } = await listAdrs(dir));
    assert.equal(items.find((item) => item.file === created.path.split('/').pop()).status, 'superseded');
  } finally {
    await cleanup(dir);
  }
});

test('document status is projected from the gate, not stored', async () => {
  const dir = await makeProject('generic');
  try {
    const { items } = await listDocs(dir);
    const project = items.find((item) => item.id === 'PROJECT');
    assert.equal(project.status, undefined);
    assert.equal(project.gate.id, 'G0');
    assert.equal(project.gate.status, 'pending');
    const shown = await showDoc(dir, 'PROJECT');
    assert.equal(shown.data.status, undefined);
  } finally {
    await cleanup(dir);
  }
});

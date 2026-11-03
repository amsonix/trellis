import test from 'node:test';
import assert from 'node:assert/strict';
import { agentBrief } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('the brief names the gate, its approvers and the read/write set', async () => {
  const dir = await makeProject('generic');
  try {
    const brief = await agentBrief(dir, { role: 'architect' });
    assert.equal(brief.stage, 'intake');
    assert.equal(brief.gate.id, 'G0');
    assert.deepEqual(brief.gate.approvers, ['human']);
    assert.deepEqual(brief.read, ['.trellis/PROJECT.md']);
    assert.deepEqual(brief.write, ['.trellis/PROJECT.md']);
    assert.ok(brief.mustNot.includes('approve a gate for work you produced'));
    assert.equal(brief.commands.approve, null);
    assert.match(brief.commands.request, /human/);
  } finally {
    await cleanup(dir);
  }
});

test('the default role is the first approver of the next gate', async () => {
  const dir = await makeProject('generic');
  try {
    const brief = await agentBrief(dir);
    assert.equal(brief.role, 'human');
    assert.match(brief.commands.approve, /--by human:/);
  } finally {
    await cleanup(dir);
  }
});

test('an unknown role is a usage error', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => agentBrief(dir, { role: 'wizard' }),
      (error) => error.code === 'USAGE'
    );
  } finally {
    await cleanup(dir);
  }
});

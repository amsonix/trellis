import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addTaskEvidence, claimTask } from '../src/core/mutations.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function withAgent(value, run) {
  const previous = process.env.TRELLIS_AGENT;
  if (value === null) delete process.env.TRELLIS_AGENT;
  else process.env.TRELLIS_AGENT = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.TRELLIS_AGENT;
    else process.env.TRELLIS_AGENT = previous;
  }
}

test('the agent id is stamped on leases, evidence and audit entries', async () => {
  const dir = await makeProject('generic');
  try {
    await withAgent('worker-7', async () => {
      await claimTask(dir, 'T-001', { by: 'executor:w1' });
      await addTaskEvidence(dir, { taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1' });
    });

    const leases = await readJson(path.join(dir, '.trellis/leases.json'));
    assert.equal(leases.items[0].agent, 'worker-7');

    const evidence = await readJson(path.join(dir, '.trellis/evidence.json'));
    assert.equal(evidence.items[0].agent, 'worker-7');

    const state = await readJson(path.join(dir, '.trellis/state.json'));
    assert.equal(state.audit.at(-1).agent, 'worker-7');
  } finally {
    await cleanup(dir);
  }
});

test('without TRELLIS_AGENT the field is null, not guessed', async () => {
  const dir = await makeProject('generic');
  try {
    await withAgent(null, async () => {
      await claimTask(dir, 'T-001', { by: 'executor:w1' });
    });
    const leases = await readJson(path.join(dir, '.trellis/leases.json'));
    assert.equal(leases.items[0].agent, null);
  } finally {
    await cleanup(dir);
  }
});

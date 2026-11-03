import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { approveGate } from '../src/core/gates.mjs';
import { addTask, claimTask, projectReport, projectStatus, runChecks } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function approveG0(dir) {
  await approveGate(dir, 'G0', { by: 'human:alice' });
}

test('an approval goes stale when its artifact changes', async () => {
  const dir = await makeProject('generic');
  try {
    await approveG0(dir);
    let checks = await runChecks(dir);
    assert.equal(checks.checks.some((check) => check.code === 'GATE_STALE'), false);

    await appendFile(path.join(dir, '.trellis/PROJECT.md'), '\nA note added after approval.\n');
    checks = await runChecks(dir);
    assert.ok(checks.checks.some((check) => check.code === 'GATE_STALE'));
    assert.equal(checks.exitCode, 3);

    const status = await projectStatus(dir);
    assert.equal(status.gates.G0.stale, true);
    assert.equal(status.staleGates[0].gate, 'G0');
    assert.deepEqual(status.staleGates[0].changed, ['PROJECT']);
  } finally {
    await cleanup(dir);
  }
});

test('a stale gate blocks the next approval until it is re-approved', async () => {
  const dir = await makeProject('generic');
  try {
    await approveG0(dir);
    await appendFile(path.join(dir, '.trellis/PROJECT.md'), '\nchanged\n');

    await assert.rejects(
      () => approveGate(dir, 'G1', { by: 'architect:ann' }),
      (error) => error.code === 'GATE_STALE'
    );

    await approveGate(dir, 'G0', { by: 'human:alice' });
    const status = await projectStatus(dir);
    assert.equal(status.staleGates.length, 0);

    await approveGate(dir, 'G1', { by: 'architect:ann' });
  } finally {
    await cleanup(dir);
  }
});

test('report lists a stale gate as a high gap', async () => {
  const dir = await makeProject('generic');
  try {
    await approveG0(dir);
    await appendFile(path.join(dir, '.trellis/PROJECT.md'), '\nchanged\n');
    const report = await projectReport(dir);
    const gap = report.gaps.find((item) => item.code === 'GATE_STALE');
    assert.ok(gap);
    assert.equal(gap.severity, 'high');
  } finally {
    await cleanup(dir);
  }
});

test('task status churn does not stale the plan gates, a new task does', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'],
      ['G1', 'architect:ann'],
      ['G2', 'architect:ann'],
      ['G3', 'human:alice'],
      ['G4', 'coordinator:kim']
    ]) {
      await approveGate(dir, gate, { by });
    }

    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    let checks = await runChecks(dir);
    assert.equal(checks.checks.some((check) => check.code === 'GATE_STALE'), false);

    await addTask(dir, {
      title: 'New work that arrived after G4',
      scope: 'docs',
      acceptance: 'the docs describe the new work',
      verification: 'manual review',
      by: 'coordinator:kim'
    });
    checks = await runChecks(dir);
    const stale = checks.checks.filter((check) => check.code === 'GATE_STALE').map((check) => check.gate);
    assert.deepEqual(stale.sort(), ['G3', 'G4']);
  } finally {
    await cleanup(dir);
  }
});

test('a whitespace-only edit does not stale an approval', async () => {
  const dir = await makeProject('generic');
  try {
    await approveG0(dir);
    await appendFile(path.join(dir, '.trellis/PROJECT.md'), '\n\n   \n');
    const checks = await runChecks(dir);
    assert.equal(checks.checks.some((check) => check.code === 'GATE_STALE'), false);
  } finally {
    await cleanup(dir);
  }
});

test('two stale plan gates are re-approved in order, not blocked by each other', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'],
      ['G1', 'architect:ann'],
      ['G2', 'architect:ann'],
      ['G3', 'human:alice'],
      ['G4', 'coordinator:kim']
    ]) {
      await approveGate(dir, gate, { by });
    }
    await addTask(dir, {
      title: 'Later work',
      scope: 'docs',
      acceptance: 'the docs say it',
      verification: 'manual review',
      by: 'coordinator:kim'
    });
    assert.deepEqual((await projectStatus(dir)).staleGates.map((item) => item.gate).sort(), ['G3', 'G4']);

    await approveGate(dir, 'G3', { by: 'human:alice' });
    assert.deepEqual((await projectStatus(dir)).staleGates.map((item) => item.gate), ['G4']);

    await approveGate(dir, 'G4', { by: 'coordinator:kim' });
    assert.equal((await projectStatus(dir)).staleGates.length, 0);
  } finally {
    await cleanup(dir);
  }
});

test('a new ADR stales the architecture approval', async () => {
  const dir = await makeProject('generic');
  try {
    for (const [gate, by] of [
      ['G0', 'human:alice'],
      ['G1', 'architect:ann'],
      ['G2', 'architect:ann'],
      ['G3', 'human:alice'],
      ['G4', 'coordinator:kim']
    ]) {
      await approveGate(dir, gate, { by });
    }
    assert.equal((await projectStatus(dir)).staleGates.length, 0);

    await writeFile(
      path.join(dir, '.trellis/docs/adr/0002-later-decision.md'),
      '# ADR-0002\n\nA later architecture decision.\n'
    );
    const status = await projectStatus(dir);
    assert.deepEqual(status.staleGates.map((item) => item.gate), ['G2']);
  } finally {
    await cleanup(dir);
  }
});

test('an approval from before digests existed is not reported stale', async () => {
  const dir = await makeProject('generic');
  try {
    await approveG0(dir);
    const stateFile = path.join(dir, '.trellis/state.json');
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    delete state.gates.G0.digest;
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const checks = await runChecks(dir);
    assert.equal(checks.checks.some((check) => check.code === 'GATE_STALE'), false);
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { approveGate, waiveGate } from '../src/core/gates.mjs';
import { projectStatus, runChecks } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('G1 without RESEARCH fails unless a human waives it', async () => {
  const dir = await makeProject('web-app');
  try {
    await rm(path.join(dir, '.trellis/docs/RESEARCH.md'));
    await approveGate(dir, 'G0', { by: 'human:alice' });

    await assert.rejects(
      () => approveGate(dir, 'G1', { by: 'architect:ann' }),
      (error) =>
        error.code === 'GATE_BLOCKED' &&
        error.details.checks.some((check) => check.code === 'RESEARCH_REQUIRED_OR_WAIVE')
    );

    const waived = await waiveGate(dir, 'G1', {
      by: 'human:alice',
      reason: 'the domain is already well understood; no research needed'
    });
    assert.equal(waived.status, 'waived');

    const status = await projectStatus(dir);
    assert.equal(status.stage, 'architecture');

    const checks = await runChecks(dir);
    assert.ok(!checks.checks.some((check) => check.code === 'ARTIFACT_MISSING' && check.severity === 'fail'));
  } finally {
    await cleanup(dir);
  }
});

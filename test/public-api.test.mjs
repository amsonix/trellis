import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/index.mjs';

test('the public library surface exports the core operations', () => {
  for (const name of [
    'initProject',
    'projectStatus',
    'runChecks',
    'nextAction',
    'claimTask',
    'reportTask',
    'addTaskEvidence',
    'verifyTask',
    'reindex',
    'approveGate',
    'waiveGate',
    'parseTasks',
    'validateTasks',
    'acquireLease',
    'releaseLease',
    'guardCommit',
    'GATE_DEFS',
    'ROLES',
    'PROTOCOL_VERSION'
  ]) {
    assert.ok(name in api, `missing export: ${name}`);
  }
  assert.equal(typeof api.initProject, 'function');
  assert.equal(typeof api.GATE_DEFS, 'object');
});

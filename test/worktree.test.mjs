import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { addEvidence, claimTask, reportTask } from '../src/core/mutations.mjs';
import { cleanup, makeProject , completeTask } from './helpers.mjs';

test('reporting done warns about a conventional leftover worktree', async () => {
  const dir = await makeProject('generic');
  try {
    await claimTask(dir, 'T-001', { by: 'executor:w1' });
    await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'manual', verdict: 'pass', by: 'executor:w1'
    });
    await mkdir(path.join(dir, '.trellis/worktrees/T-001'), { recursive: true });

    const result = await completeTask(dir, 'T-001', { by: 'executor:w1' });
    const warning = result.warnings.find((item) => item.code === 'WORKTREE_REMAINS');
    assert.ok(warning);
    assert.equal(warning.path, '.trellis/worktrees/T-001');
    assert.match(warning.cleanup, /git worktree remove/);
  } finally {
    await cleanup(dir);
  }
});

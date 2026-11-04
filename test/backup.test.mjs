import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backup, restore } from '../src/core/backup.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('backup writes .trellis and a manifest; restore brings it back', async () => {
  const dir = await makeProject('generic');
  const out = path.join(await mkdtemp(path.join(os.tmpdir(), 'trellis-backup-')), 'snapshot');
  const target = await mkdtemp(path.join(os.tmpdir(), 'trellis-restore-'));
  try {
    const made = await backup(dir, { out });
    assert.equal(made.project, 'test-project');
    await access(path.join(out, '.trellis/state.json'));
    const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 3);

    await restore(target, { from: out });
    const { tasks } = await parseTasks(target);
    assert.equal(tasks.length, 1);
    await access(path.join(target, '.trellis/state.json'));
  } finally {
    await cleanup(dir);
    await cleanup(out);
    await cleanup(target);
  }
});

test('backup refuses an existing target and restore refuses to overwrite', async () => {
  const dir = await makeProject('generic');
  const out = await mkdtemp(path.join(os.tmpdir(), 'trellis-backup-'));
  const existing = await makeProject('generic');
  try {
    await assert.rejects(() => backup(dir, { out }), (error) => error.code === 'BACKUP_EXISTS');
    await assert.rejects(
      () => restore(existing, { from: dir }),
      (error) => error.code === 'RESTORE_EXISTS'
    );
  } finally {
    await cleanup(dir);
    await cleanup(out);
    await cleanup(existing);
  }
});

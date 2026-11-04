import fs from 'node:fs/promises';
import path from 'node:path';
import { PROTOCOL_VERSION } from './constants.mjs';
import { RefusedError, UsageError } from './errors.mjs';
import { loadState } from './store.mjs';
import { exists, nowIso } from './util.mjs';

export async function backup(root, { out } = {}) {
  if (!out) throw new UsageError('backup needs --out <directory>');
  const target = path.resolve(out);
  if (await exists(target)) {
    throw new RefusedError('BACKUP_EXISTS', `${target} already exists; choose a new directory`, { out: target });
  }
  const state = await loadState(root);
  const source = path.join(root, '.trellis');
  await fs.mkdir(target, { recursive: true });
  await fs.cp(source, path.join(target, '.trellis'), { recursive: true });
  const manifest = {
    createdAt: nowIso(),
    protocol: PROTOCOL_VERSION,
    schemaVersion: state.schemaVersion,
    project: state.project.name
  };
  await fs.writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { out: target, schemaVersion: state.schemaVersion, project: state.project.name };
}

export async function restore(root, { from, force = false } = {}) {
  if (!from) throw new UsageError('restore needs --from <directory>');
  const source = path.join(path.resolve(from), '.trellis');
  if (!(await exists(path.join(source, 'state.json')))) {
    throw new UsageError(`${path.resolve(from)} does not look like a Trellis backup (no .trellis/state.json)`);
  }
  const destination = path.join(root, '.trellis');
  if (await exists(destination)) {
    if (!force) {
      throw new RefusedError('RESTORE_EXISTS', `${destination} already exists; pass --force to replace it`, {
        root
      });
    }
    await fs.rm(destination, { recursive: true, force: true });
  }
  await fs.cp(source, destination, { recursive: true });
  const state = await loadState(root);
  return { root, restoredFrom: path.resolve(from), project: state.project.name };
}

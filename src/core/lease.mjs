import fs from 'node:fs/promises';
import path from 'node:path';
import { RefusedError, UsageError } from './errors.mjs';
import { covers, exists, nowIso, overlaps, parseActor, readJson, writeJson } from './util.mjs';
import { STATE_DIR } from './store.mjs';
import { currentAgent } from './identity.mjs';
import { parseTasks, taskById } from './tasks.mjs';

export const LEASES_FILE = `${STATE_DIR}/leases.json`;
export const LEASE_ARCHIVE = `${STATE_DIR}/leases.archive.jsonl`;

export function leasesPath(root) {
  return path.join(root, LEASES_FILE);
}

async function appendArchive(root, leases) {
  if (leases.length === 0) return;
  const file = path.join(root, LEASE_ARCHIVE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${leases.map((lease) => JSON.stringify(lease)).join('\n')}\n`, 'utf8');
}

export async function loadLeases(root) {
  const file = leasesPath(root);
  let data;
  try {
    data = await readJson(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 2, items: [] };
    throw error;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const released = items.filter((lease) => lease.state !== 'held');
  const held = items.filter((lease) => lease.state === 'held');
  // Older ledgers kept released leases forever; move them to the archive once.
  if (released.length > 0) {
    await appendArchive(root, released);
    await writeJson(file, { schemaVersion: 2, items: held });
  }
  return { schemaVersion: 2, items: held };
}

export async function saveLeases(root, ledger) {
  await writeJson(leasesPath(root), {
    schemaVersion: 2,
    items: ledger.items.filter((lease) => lease.state === 'held')
  });
}

export async function leaseStatus(root) {
  const ledger = await loadLeases(root);
  return ledger.items.filter((lease) => lease.state === 'held');
}

export async function acquireLease(root, { taskId, actor, domains }) {
  if (!taskId) throw new UsageError('a task id is required to acquire a lease');
  const parsedActor = parseActor(actor);
  const wanted = [...new Set((domains ?? []).map((domain) => String(domain).trim()).filter(Boolean))];
  if (wanted.length === 0) throw new UsageError('a lease needs at least one domain');

  const ledger = await loadLeases(root);
  const held = ledger.items.filter((lease) => lease.state === 'held');
  const existing = held.find((lease) => lease.taskId === taskId);
  if (existing) return existing;

  const conflicts = [];
  for (const lease of held) {
    if (lease.taskId === taskId) continue;
    for (const a of wanted) {
      for (const b of lease.domains) {
        if (overlaps(a, b)) conflicts.push({ domain: a, lease, other: b });
      }
    }
  }
  if (conflicts.length > 0) {
    throw new RefusedError(
      'LEASE_CONFLICT',
      `cannot lease ${wanted.join(', ')} for ${taskId}: ${conflicts
        .map((conflict) => `${conflict.domain} is held by ${conflict.lease.taskId} (${conflict.lease.actor})`)
        .join('; ')}`,
      { conflicts: conflicts.map((conflict) => ({ domain: conflict.domain, taskId: conflict.lease.taskId, actor: conflict.lease.actor })) }
    );
  }

  const lease = {
    id: `L-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    actor: parsedActor.raw,
    agent: currentAgent(),
    domains: wanted,
    state: 'held',
    createdAt: nowIso(),
    releasedAt: null
  };
  ledger.items.push(lease);
  await saveLeases(root, ledger);
  return lease;
}

export async function releaseLease(root, taskId, actor = null) {
  if (!taskId) throw new UsageError('releaseLease needs a task id');
  const parsedActor = actor ? parseActor(actor) : null;
  const ledger = await loadLeases(root);
  const released = [];
  for (const lease of ledger.items) {
    if (lease.taskId === taskId && lease.state === 'held') {
      lease.state = 'released';
      lease.releasedAt = nowIso();
      lease.releasedBy = parsedActor?.raw ?? null;
      released.push(lease);
    }
  }
  if (released.length === 0) return false;
  await appendArchive(root, released);
  await saveLeases(root, ledger);
  return true;
}

export async function guardCommit(root, { taskId, stagedPaths, observe = false }) {
  if (!taskId) throw new UsageError('guard commit needs --task <T-NNN>');
  if (!Array.isArray(stagedPaths) || stagedPaths.length === 0) {
    throw new UsageError('guard commit needs a non-empty list of staged paths');
  }

  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  const violations = [];
  if (!task) {
    violations.push({ code: 'TASK_UNKNOWN', message: `task ${taskId} is not on the task board`, path: null });
  }

  const held = (await loadLeases(root)).items.filter((lease) => lease.state === 'held');
  for (const file of stagedPaths) {
    const relative = file.replace(/^\.\//, '');
    if (task) {
      const inScope = task.scope.some((domain) => covers(domain, relative));
      if (!inScope) {
        violations.push({
          code: 'OUT_OF_SCOPE',
          message: `${relative} is outside the write scope of ${taskId} (${task.scope.join(', ')})`,
          path: relative
        });
      }
    }
    for (const lease of held) {
      if (lease.taskId === taskId) continue;
      if (lease.domains.some((domain) => covers(domain, relative))) {
        violations.push({
          code: 'FOREIGN_LEASE',
          message: `${relative} is leased by ${lease.taskId} (${lease.actor})`,
          path: relative,
          holder: lease.taskId,
          actor: lease.actor
        });
      }
    }
  }

  return {
    ok: observe ? true : violations.length === 0,
    observed: observe,
    taskId,
    stagedPaths,
    violations
  };
}

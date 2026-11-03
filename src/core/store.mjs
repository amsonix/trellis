import fs from 'node:fs/promises';
import path from 'node:path';
import { SCHEMA_VERSION, ALL_GATES, META_DIR } from './constants.mjs';
import { UnavailableError } from './errors.mjs';
import { nowIso, readJson, writeJson } from './util.mjs';

export const STATE_DIR = META_DIR;
export const STATE_FILE = 'state.json';
export const AUDIT_FILE = 'audit.jsonl';
export const AUDIT_KEEP = 200;

export function stateDir(root) {
  return path.join(root, STATE_DIR);
}

export function statePath(root) {
  return path.join(stateDir(root), STATE_FILE);
}

export function defaultState({ name, profile }) {
  const now = nowIso();
  const gates = {};
  for (const id of ALL_GATES) {
    gates[id] = {
      id,
      status: 'pending',
      approvedBy: null,
      at: null,
      note: null,
      reason: null
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      name,
      profile,
      createdAt: now,
      updatedAt: now
    },
    gates,
    taskGates: {},
    audit: [],
    auditFlushed: 0
  };
}

export async function loadState(root) {
  const file = statePath(root);
  let state;
  try {
    state = await readJson(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new UnavailableError(`no protocol state at ${STATE_DIR}/state.json; run "trellis reindex" or "trellis init"`, {
        path: file
      });
    }
    throw new UnavailableError(`cannot read ${file}: ${error.message}`, { path: file });
  }
  if (!state || typeof state !== 'object') {
    throw new UnavailableError(`${file} is not a JSON object`, { path: file });
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new UnavailableError(`unsupported state schema ${state.schemaVersion}; this build understands ${SCHEMA_VERSION}`, {
      path: file,
      found: state.schemaVersion
    });
  }
  state.gates = state.gates ?? {};
  for (const id of ALL_GATES) {
    state.gates[id] = {
      id,
      status: 'pending',
      approvedBy: null,
      at: null,
      note: null,
      reason: null,
      ...(state.gates[id] ?? {})
    };
  }
  state.taskGates = state.taskGates ?? {};
  state.audit = Array.isArray(state.audit) ? state.audit : [];
  state.auditFlushed = Number.isInteger(state.auditFlushed) ? state.auditFlushed : 0;
  return state;
}

async function flushAudit(root, state) {
  const items = Array.isArray(state.audit) ? state.audit : [];
  const flushed = Number.isInteger(state.auditFlushed) ? state.auditFlushed : 0;
  const fresh = items.slice(flushed);
  if (fresh.length > 0) {
    const file = path.join(root, STATE_DIR, AUDIT_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${fresh.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    state.auditFlushed = items.length;
  }
  if (items.length > AUDIT_KEEP) {
    state.audit = items.slice(-AUDIT_KEEP);
    state.auditFlushed = state.audit.length;
  }
}

export async function saveState(root, state) {
  state.project.updatedAt = nowIso();
  await flushAudit(root, state);
  const file = statePath(root);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeJson(tmp, state);
  await fs.rename(tmp, file);
}

export function appendAudit(state, action, actor = null, detail = null) {
  state.audit.push({
    at: nowIso(),
    action,
    actor: actor ? (typeof actor === 'string' ? actor : actor.raw ?? `${actor.role}:${actor.name}`) : null,
    detail
  });
  if (state.audit.length > 2000) {
    state.audit = state.audit.slice(-2000);
  }
}

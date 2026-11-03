import fs from 'node:fs/promises';
import path from 'node:path';
import { EVIDENCE_KINDS, EVIDENCE_VERDICTS } from './constants.mjs';
import { makeCheck } from './checks.mjs';
import { RefusedError, UsageError } from './errors.mjs';
import { exists, fileSha256, nowIso, parseActor, readText, renameWithRetry } from './util.mjs';
import { STATE_DIR } from './store.mjs';
import { currentAgent } from './identity.mjs';

export const EVIDENCE_FILE = `${STATE_DIR}/evidence.jsonl`;
export const EVIDENCE_ARCHIVE = `${STATE_DIR}/evidence.archive.jsonl`;
export const LEGACY_EVIDENCE_FILE = `${STATE_DIR}/evidence.json`;

export function evidencePath(root) {
  return path.join(root, EVIDENCE_FILE);
}

export function evidenceArchivePath(root) {
  return path.join(root, EVIDENCE_ARCHIVE);
}

function legacyPath(root) {
  return path.join(root, LEGACY_EVIDENCE_FILE);
}

async function appendEvent(file, event) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
}

async function readEvents(root) {
  const file = evidencePath(root);
  let text;
  try {
    text = await readText(file);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A torn final line from a crash is ignored; the rest of the log is valid.
    }
  }
  return events;
}

function fold(events) {
  const records = new Map();
  for (const event of events) {
    if (event.type === 'add') {
      const { type, ...record } = event;
      records.set(record.id, { ...record, retracted: record.retracted ?? null });
    } else if (event.type === 'retract') {
      const record = records.get(event.id);
      if (record) record.retracted = { by: event.by, at: event.at, reason: event.reason };
    }
  }
  return [...records.values()];
}

export async function migrateLegacyEvidence(root) {
  const legacy = legacyPath(root);
  if (!(await exists(legacy))) return false;
  const data = JSON.parse(await readText(legacy));
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 0) {
    for (const item of items) await appendEvent(evidencePath(root), { type: 'add', ...item });
  }
  await renameWithRetry(legacy, `${legacy}.migrated`);
  return true;
}

export async function loadEvidence(root) {
  await migrateLegacyEvidence(root);
  return { schemaVersion: 2, items: fold(await readEvents(root)) };
}

export async function listEvidence(root, taskId = null) {
  const { items } = await loadEvidence(root);
  return taskId ? items.filter((item) => item.taskId === taskId) : items;
}

export async function addEvidence(root, { taskId, kind, uri, verdict, by, note = null, proves = null }) {
  if (!taskId) throw new UsageError('evidence add needs --task <T-NNN>');
  if (!EVIDENCE_KINDS.includes(kind)) {
    throw new UsageError(`--kind must be one of: ${EVIDENCE_KINDS.join(', ')}`);
  }
  if (!EVIDENCE_VERDICTS.includes(verdict)) {
    throw new UsageError(`--verdict must be one of: ${EVIDENCE_VERDICTS.join(', ')}`);
  }
  if (!uri) throw new UsageError('evidence add needs --uri <file|url|commit>');
  const actor = parseActor(by);
  if (proves !== null && String(proves).trim() === '') {
    throw new UsageError('--proves must name what the evidence proves');
  }

  let digest = null;
  const local = path.resolve(root, uri);
  if (!/^https?:\/\//.test(uri) && !/^[0-9a-f]{7,40}$/i.test(uri) && (await exists(local))) {
    digest = await fileSha256(local);
  }

  const record = {
    type: 'add',
    id: `EV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    kind,
    uri,
    sha256: digest,
    verdict,
    producedBy: actor.raw,
    producedAt: nowIso(),
    agent: currentAgent(),
    note,
    proves: proves === null ? null : String(proves).trim()
  };
  await appendEvent(evidencePath(root), record);
  const { type, ...rest } = record;
  return rest;
}

export const RETRACTOR_ROLES = ['human', 'reviewer', 'verifier'];

export async function retractEvidence(root, evidenceId, { by, reason }) {
  if (!evidenceId) throw new UsageError('evidence retract needs an evidence id');
  if (!by) throw new UsageError('evidence retract needs --by <role>:<name>');
  if (!reason || String(reason).trim() === '') {
    throw new UsageError('evidence retract needs --reason "<why>"');
  }
  const actor = parseActor(by);
  if (!RETRACTOR_ROLES.includes(actor.role)) {
    throw new RefusedError(
      'EVIDENCE_RETRACT_ROLE',
      `${actor.raw} cannot retract evidence; allowed: ${RETRACTOR_ROLES.join(', ')}`,
      { actor: actor.raw, allowed: RETRACTOR_ROLES }
    );
  }

  const { items } = await loadEvidence(root);
  const record = items.find((item) => item.id === evidenceId);
  if (!record) {
    throw new RefusedError('EVIDENCE_UNKNOWN', `no evidence record '${evidenceId}'`, { evidence: evidenceId });
  }
  if (record.retracted) {
    throw new RefusedError('EVIDENCE_ALREADY_RETRACTED', `evidence ${evidenceId} is already retracted`, {
      evidence: evidenceId
    });
  }

  const event = { type: 'retract', id: evidenceId, by: actor.raw, at: nowIso(), reason: String(reason).trim() };
  await appendEvent(evidencePath(root), event);
  return { ...record, retracted: { by: event.by, at: event.at, reason: event.reason } };
}

export async function verifyTaskEvidence(root, taskId) {
  const items = (await listEvidence(root, taskId)).filter((item) => !item.retracted);
  const checks = [];
  const add = (code, severity, message, extra = {}) =>
    checks.push(makeCheck(code, severity, message, { stage: 'executing', task: taskId, ...extra }));

  if (items.length === 0) {
    add('EVIDENCE_MISSING', 'fail', `task ${taskId} has no active evidence`);
    return checks;
  }

  const fails = items.filter((item) => item.verdict === 'fail');
  const passes = items.filter((item) => item.verdict === 'pass');
  const inconclusive = items.filter((item) => item.verdict === 'inconclusive');

  for (const item of fails) {
    add('EVIDENCE_FAIL', 'fail', `task ${taskId} has failing evidence ${item.id} (${item.uri})`, { evidence: item.id });
  }
  if (passes.length === 0) {
    add('EVIDENCE_NO_PASS', 'fail', `task ${taskId} has no passing evidence`);
  }
  if (inconclusive.length > 0) {
    add(
      'EVIDENCE_INCONCLUSIVE',
      passes.length > 0 ? 'warn' : 'fail',
      `task ${taskId} has ${inconclusive.length} inconclusive evidence item(s); inconclusive is not a pass`,
      { evidence: inconclusive.map((item) => item.id) }
    );
  }
  return checks;
}

export async function requirePassingEvidence(root, taskId) {
  const checks = await verifyTaskEvidence(root, taskId);
  const blocking = checks.filter((check) => check.severity === 'fail' || check.severity === 'unavailable');
  if (blocking.length > 0) {
    throw new RefusedError(
      'EVIDENCE_REQUIRED',
      `task ${taskId} cannot be marked done: ${blocking.map((check) => check.message).join('; ')}`,
      { checks }
    );
  }
  return checks;
}

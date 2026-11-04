import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EVIDENCE_KINDS, EVIDENCE_VERDICTS } from './constants.mjs';
import { makeCheck } from './checks.mjs';
import { ProtocolError, RefusedError, UsageError } from './errors.mjs';
import { exists, fileSha256, nowIso, parseActor, readText, renameWithRetry, assertMaxLength, syncFile, syncDirectory } from './util.mjs';
import { STATE_DIR } from './store.mjs';
import { currentAgent } from './identity.mjs';
import { gitInfo, headCommit } from './git.mjs';

export const EVIDENCE_DIR = `${STATE_DIR}/evidence`;
export const EVIDENCE_ARCHIVE_DIR = `${STATE_DIR}/evidence/archive`;
export const EVIDENCE_FILE = `${STATE_DIR}/evidence.jsonl`;
export const LEGACY_EVIDENCE_FILE = `${STATE_DIR}/evidence.json`;

export function evidenceDirPath(root) {
  return path.join(root, EVIDENCE_DIR);
}

export function shardPath(root, taskId) {
  return path.join(root, EVIDENCE_DIR, `${taskId}.jsonl`);
}

export function evidenceArchivePath(root) {
  return path.join(root, EVIDENCE_ARCHIVE_DIR);
}

function legacyLogPath(root) {
  return path.join(root, EVIDENCE_FILE);
}

function legacyJsonPath(root) {
  return path.join(root, LEGACY_EVIDENCE_FILE);
}

const shardCache = new Map();

async function appendEvent(file, event) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'a');
  try {
    await handle.appendFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

function parseLines(text, file) {
  const lines = text.split('\n');
  const events = [];
  const tornFinalLine = !text.endsWith('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      if (tornFinalLine && index === lines.length - 1) continue;
      throw new ProtocolError(
        'EVIDENCE_CORRUPT',
        `evidence log is corrupt at line ${index + 1}: ${file}`,
        { file, line: index + 1 },
        4
      );
    }
  }
  return events;
}

async function readFileEvents(file) {
  let text;
  try {
    text = await readText(file);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  const cached = shardCache.get(file);
  if (cached?.digest === digest) return cached.events;
  const events = parseLines(text, file);
  shardCache.set(file, { digest, events });
  return events;
}

export function foldEvidence(events) {
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

async function listShardFiles(root) {
  try {
    const entries = await fs.readdir(evidenceDirPath(root), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(evidenceDirPath(root), entry.name))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeShard(file, records) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const text = records.length > 0 ? `${records.map((record) => JSON.stringify({ type: 'add', ...record })).join('\n')}\n` : '';
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await syncFile(tmp);
  await renameWithRetry(tmp, file);
  await syncDirectory(path.dirname(file));
}

async function collectLegacy(root) {
  const groups = new Map();
  const addRecord = (record) => {
    if (!record?.taskId || !record?.id) return;
    if (!groups.has(record.taskId)) groups.set(record.taskId, new Map());
    groups.get(record.taskId).set(record.id, record);
  };

  if (await exists(legacyJsonPath(root))) {
    const data = JSON.parse(await readText(legacyJsonPath(root)));
    for (const item of Array.isArray(data.items) ? data.items : []) addRecord(item);
  }
  if (await exists(legacyLogPath(root))) {
    for (const record of foldEvidence(parseLines(await readText(legacyLogPath(root)), legacyLogPath(root)))) {
      addRecord(record);
    }
  }
  return groups;
}

export async function migrateLegacyEvidence(root) {
  const hasLegacy = (await exists(legacyJsonPath(root))) || (await exists(legacyLogPath(root)));
  if (!hasLegacy) return false;

  const groups = await collectLegacy(root);
  for (const [taskId, records] of groups) {
    const file = shardPath(root, taskId);
    for (const record of foldEvidence(await readFileEvents(file))) {
      if (!records.has(record.id)) records.set(record.id, record);
    }
    await writeShard(file, [...records.values()]);
  }

  for (const legacy of [legacyJsonPath(root), legacyLogPath(root)]) {
    if (await exists(legacy)) {
      try {
        await renameWithRetry(legacy, `${legacy}.migrated`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return true;
}

export async function readEvidenceEvents(root, { taskId = null } = {}) {
  await migrateLegacyEvidence(root);
  if (taskId) return readFileEvents(shardPath(root, taskId));
  const events = [];
  for (const file of await listShardFiles(root)) events.push(...(await readFileEvents(file)));
  return events;
}

export async function loadEvidence(root, options = {}) {
  await migrateLegacyEvidence(root);
  return { schemaVersion: 3, items: foldEvidence(await readEvidenceEvents(root, options)) };
}

export async function listEvidence(root, taskId = null) {
  const { items } = await loadEvidence(root, taskId ? { taskId } : {});
  return taskId ? items.filter((item) => item.taskId === taskId) : items;
}

export async function addEvidence(root, { taskId, kind, uri, verdict, by, note = null, proves = null }) {
  if (!taskId) throw new UsageError('evidence add needs --task <T-NNN>');
  if (!/^T-\d+$/.test(taskId)) throw new UsageError(`task id '${taskId}' does not look like T-001`);
  if (!EVIDENCE_KINDS.includes(kind)) {
    throw new UsageError(`--kind must be one of: ${EVIDENCE_KINDS.join(', ')}`);
  }
  if (!EVIDENCE_VERDICTS.includes(verdict)) {
    throw new UsageError(`--verdict must be one of: ${EVIDENCE_VERDICTS.join(', ')}`);
  }
  if (!uri) throw new UsageError('evidence add needs --uri <file|url|commit>');
  assertMaxLength(uri, 'uri', 500);
  if (note !== null) assertMaxLength(note, 'note', 2000);
  const actor = parseActor(by);
  if (proves !== null) {
    if (String(proves).trim() === '') throw new UsageError('--proves must name what the evidence proves');
    assertMaxLength(proves, 'proves', 500);
  }

  let digest = null;
  const remote = /^https?:\/\//.test(uri) || /^[0-9a-f]{7,40}$/i.test(uri);
  const local = path.resolve(root, uri);
  if (!remote) {
    const relative = path.relative(root, local);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new UsageError('--uri must stay inside the project; use a URL or a commit for external evidence');
    }
    if (await exists(local)) digest = await fileSha256(local);
  }

  const git = await gitInfo(root);
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
    proves: proves === null ? null : String(proves).trim(),
    commit: git.commit,
    dirty: git.dirty,
    worktree: git.worktree
  };
  await appendEvent(shardPath(root, taskId), record);
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
  assertMaxLength(reason, 'reason', 1000);
  const actor = parseActor(by);
  if (!RETRACTOR_ROLES.includes(actor.role)) {
    throw new RefusedError(
      'EVIDENCE_RETRACT_ROLE',
      `${actor.raw} cannot retract evidence; allowed: ${RETRACTOR_ROLES.join(', ')}`,
      { actor: actor.raw, allowed: RETRACTOR_ROLES }
    );
  }

  await migrateLegacyEvidence(root);
  for (const file of await listShardFiles(root)) {
    const record = foldEvidence(await readFileEvents(file)).find((item) => item.id === evidenceId);
    if (!record) continue;
    if (record.retracted) {
      throw new RefusedError('EVIDENCE_ALREADY_RETRACTED', `evidence ${evidenceId} is already retracted`, {
        evidence: evidenceId
      });
    }
    const event = { type: 'retract', id: evidenceId, by: actor.raw, at: nowIso(), reason: String(reason).trim() };
    await appendEvent(file, event);
    return { ...record, retracted: { by: event.by, at: event.at, reason: event.reason } };
  }
  throw new RefusedError('EVIDENCE_UNKNOWN', `no evidence record '${evidenceId}'`, { evidence: evidenceId });
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
  const head = await headCommit(root);
  const drifted = items.filter((item) => item.commit && head && item.commit !== head);
  if (drifted.length > 0) {
    add(
      'EVIDENCE_TREE_DRIFT',
      'warn',
      `task ${taskId} has ${drifted.length} evidence item(s) from another commit; HEAD is ${head.slice(0, 7)}`,
      { evidence: drifted.map((item) => item.id), head }
    );
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

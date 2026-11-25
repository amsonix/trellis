import fs from 'node:fs/promises';
import path from 'node:path';
import { META_DIR } from './constants.mjs';
import { RefusedError, UsageError, ProtocolError } from './errors.mjs';
import { exists, nowIso, parseActor, syncFile, syncDirectory } from './util.mjs';

export const RECORDS_FILE = `${META_DIR}/records.jsonl`;

const KINDS = ['gap', 'decision'];
const STATUSES = ['open', 'resolved'];
const SEVERITIES = ['high', 'medium', 'low'];

function recordsPath(root) {
  return path.join(root, RECORDS_FILE);
}

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

async function loadRecords(root) {
  const file = recordsPath(root);
  if (!(await exists(file))) return new Map();
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const torn = !text.endsWith('\n');
  const map = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      if (torn && i === lines.length - 1) continue;
      throw new ProtocolError('RECORDS_CORRUPT', `records log corrupt at line ${i + 1}`, { file, line: i + 1 }, 4);
    }
    if (event.type === 'add') {
      map.set(event.id, {
        id: event.id,
        kind: event.kind,
        text: event.text,
        fromTask: event.fromTask ?? null,
        severity: event.severity ?? 'medium',
        owner: event.owner ?? null,
        status: 'open',
        createdAt: event.createdAt,
        by: event.by,
        resolution: null,
        resolvedAt: null,
        resolvedBy: null,
        followUp: null
      });
    } else if (event.type === 'resolve') {
      const record = map.get(event.id);
      if (record) {
        record.status = 'resolved';
        record.resolution = event.resolution;
        record.resolvedAt = event.at;
        record.resolvedBy = event.by;
        record.followUp = event.followUp ?? null;
      }
    }
  }
  return map;
}

export async function listRecords(root, { openOnly = false, kind = null, fromTask = null, status = null, severity = null } = {}) {
  const records = [...(await loadRecords(root)).values()];
  return records
    .filter((record) => (openOnly ? record.status === 'open' : true))
    .filter((record) => (kind ? record.kind === kind : true))
    .filter((record) => (fromTask ? record.fromTask === fromTask : true))
    .filter((record) => (status ? record.status === status : true))
    .filter((record) => (severity ? record.severity === severity : true))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function nextId(records) {
  const used = new Set(records.keys());
  let n = 1;
  while (used.has(`R-${String(n).padStart(3, '0')}`)) n += 1;
  return `R-${String(n).padStart(3, '0')}`;
}

export async function addRecord(root, { kind, text, fromTask = null, severity = 'medium', owner = null, by }) {
  if (!KINDS.includes(kind)) throw new UsageError('--kind must be gap or decision');
  if (!text || String(text).trim() === '') throw new UsageError('record needs --text');
  if (!by) throw new UsageError('record needs --by <role>:<name>');
  if (!SEVERITIES.includes(severity)) throw new UsageError('--severity must be high, medium or low');
  parseActor(by);
  if (owner) parseActor(owner);
  const records = await loadRecords(root);
  const record = {
    type: 'add',
    id: nextId(records),
    kind,
    text: String(text).trim(),
    fromTask: fromTask ? String(fromTask).trim() : null,
    severity,
    owner: owner ? String(owner).trim() : null,
    createdAt: nowIso(),
    by: String(by).trim()
  };
  await appendEvent(recordsPath(root), record);
  return { ...record, status: 'open', resolution: null, resolvedAt: null, resolvedBy: null };
}

export async function resolveRecord(root, id, { resolution, by, followUp = null }) {
  if (!id) throw new UsageError('record resolve needs an id');
  if (!resolution || String(resolution).trim() === '') throw new UsageError('record resolve needs --resolution');
  if (!by) throw new UsageError('record resolve needs --by <role>:<name>');
  const actor = parseActor(by);
  const records = await loadRecords(root);
  const record = records.get(id);
  if (!record) throw new RefusedError('RECORD_UNKNOWN', `no record '${id}'`, { record: id });
  if (record.status === 'resolved') {
    throw new RefusedError('RECORD_RESOLVED', `record ${id} is already resolved`, { record: id });
  }
  if (record.kind === 'decision' && actor.role !== 'human') {
    throw new RefusedError('RECORD_RESOLVE_ROLE', `only a human can resolve decision ${id}`, {
      record: id,
      actor: actor.raw
    });
  }
  if (followUp !== null && !['required', 'none'].includes(followUp)) {
    throw new UsageError('--follow-up must be required or none');
  }
  if (record.kind === 'decision' && followUp === null) {
    throw new UsageError('resolving a decision needs --follow-up required|none');
  }
  const event = {
    type: 'resolve',
    id,
    resolution: String(resolution).trim(),
    at: nowIso(),
    by: actor.raw,
    followUp
  };
  await appendEvent(recordsPath(root), event);
  return { ...record, status: 'resolved', resolution: event.resolution, resolvedAt: event.at, resolvedBy: event.by, followUp };
}

export async function recordSummary(root) {
  const records = await listRecords(root, { openOnly: true });
  return {
    open: records.length,
    gap: records.filter((record) => record.kind === 'gap').length,
    decision: records.filter((record) => record.kind === 'decision').length,
    high: records.filter((record) => record.severity === 'high').length
  };
}

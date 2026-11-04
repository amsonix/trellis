/**
 * Fold evidence shards and rotate the audit stream.
 *
 * v3 stores one append-only shard per task. Compaction folds each shard to one
 * `add` line per record (retraction state included) and can move old retracted
 * records to evidence/archive.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EVIDENCE_ARCHIVE_DIR,
  EVIDENCE_DIR,
  evidenceArchivePath,
  evidenceDirPath,
  foldEvidence,
  migrateLegacyEvidence,
  readEvidenceEvents
} from './evidence.mjs';
import { AUDIT_FILE, STATE_DIR } from './store.mjs';
import { readText, renameWithRetry } from './util.mjs';

const DEFAULT_AUDIT_BYTES = 5 * 1024 * 1024;

async function readSize(file) {
  try {
    const text = await readText(file);
    return { lines: text.split('\n').filter(Boolean).length, bytes: Buffer.byteLength(text) };
  } catch (error) {
    if (error.code === 'ENOENT') return { lines: 0, bytes: 0 };
    throw error;
  }
}

async function shardFiles(root) {
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

async function writeShardFile(file, records) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const text = records.length > 0 ? `${records.map((record) => JSON.stringify({ type: 'add', ...record })).join('\n')}\n` : '';
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await renameWithRetry(tmp, file);
}

async function compactEvidence(root, { dryRun = false, archiveRetractedDays = 0 } = {}) {
  if (!dryRun) await migrateLegacyEvidence(root);

  const files = await shardFiles(root);
  let beforeLines = 0;
  let beforeBytes = 0;
  const groups = new Map();
  for (const file of files) {
    const text = await readText(file);
    beforeLines += text.split('\n').filter(Boolean).length;
    beforeBytes += Buffer.byteLength(text);
    const taskId = path.basename(file, '.jsonl');
    groups.set(taskId, foldEvidence(await readEvidenceEvents(root, { taskId })));
  }

  const cutoff = archiveRetractedDays > 0 ? Date.now() - archiveRetractedDays * 86_400_000 : null;
  const archived = [];
  const kept = [];
  for (const [taskId, records] of groups) {
    const old = cutoff ? records.filter((record) => record.retracted && Date.parse(record.producedAt) < cutoff) : [];
    const active = cutoff ? records.filter((record) => !old.includes(record)) : records;
    archived.push(...old.map((record) => ({ taskId, record })));
    kept.push({ taskId, records: active });
  }

  const afterLines = kept.reduce((sum, item) => sum + item.records.length, 0);
  const textLines = kept.map((item) => `${item.records.map((record) => JSON.stringify({ type: 'add', ...record })).join('\n')}${item.records.length ? '\n' : ''}`).join('');
  const after = { lines: afterLines, bytes: Buffer.byteLength(textLines) };

  if (!dryRun) {
    for (const { taskId, record } of archived) {
      const file = path.join(evidenceArchivePath(root), `${taskId}.jsonl`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${JSON.stringify({ type: 'add', ...record })}\n`, 'utf8');
    }
    for (const { taskId, records } of kept) {
      await writeShardFile(path.join(evidenceDirPath(root), `${taskId}.jsonl`), records);
    }
  }

  return {
    file: EVIDENCE_DIR,
    before: { lines: beforeLines, bytes: beforeBytes },
    after,
    archived: archived.length,
    archive: archived.length > 0 ? EVIDENCE_ARCHIVE_DIR : null,
    dryRun
  };
}

async function rotateAudit(root, { maxBytes = DEFAULT_AUDIT_BYTES, dryRun = false } = {}) {
  const file = path.join(root, STATE_DIR, AUDIT_FILE);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (stat.size <= maxBytes) return null;
  const name = `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  const target = path.join(root, STATE_DIR, name);
  if (!dryRun) await renameWithRetry(file, target);
  return { from: `${STATE_DIR}/${AUDIT_FILE}`, to: `${STATE_DIR}/${name}`, bytes: stat.size, dryRun };
}

export async function compact(root, options = {}) {
  const evidence = await compactEvidence(root, options);
  const audit = await rotateAudit(root, options);
  return { evidence, audit };
}

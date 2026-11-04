/**
 * Fold the evidence event log and rotate the audit stream.
 *
 * Evidence is append-only, so `add` is O(1) but readers replay every event.
 * Compaction rewrites one `add` line per live record (retraction state folded
 * into the record) and leaves the observable state unchanged.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { EVIDENCE_ARCHIVE, EVIDENCE_FILE, evidenceArchivePath, evidencePath, foldEvidence, loadEvidence, readEvidenceEvents } from './evidence.mjs';
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

async function compactEvidence(root, { dryRun = false, archiveRetractedDays = 0 } = {}) {
  const file = evidencePath(root);
  const before = await readSize(file);
  const items = dryRun
    ? foldEvidence(await readEvidenceEvents(root))
    : (await loadEvidence(root)).items;

  const cutoff = archiveRetractedDays > 0 ? Date.now() - archiveRetractedDays * 86_400_000 : null;
  const archived = cutoff
    ? items.filter((item) => item.retracted && Date.parse(item.producedAt) < cutoff)
    : [];
  const kept = cutoff ? items.filter((item) => !archived.includes(item)) : items;

  const line = (item) => JSON.stringify({ type: 'add', ...item });
  const text = kept.length > 0 ? `${kept.map(line).join('\n')}\n` : '';
  const after = { lines: kept.length, bytes: Buffer.byteLength(text) };

  if (!dryRun) {
    if (archived.length > 0) {
      const archive = evidenceArchivePath(root);
      await fs.mkdir(path.dirname(archive), { recursive: true });
      await fs.appendFile(archive, `${archived.map(line).join('\n')}\n`, 'utf8');
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await renameWithRetry(tmp, file);
  }
  return {
    file: EVIDENCE_FILE,
    before,
    after,
    archived: archived.length,
    archive: archived.length > 0 ? EVIDENCE_ARCHIVE : null,
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

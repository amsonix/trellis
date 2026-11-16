import fs from 'node:fs/promises';
import path from 'node:path';
import { META_DIR } from './constants.mjs';
import { RefusedError, UsageError } from './errors.mjs';
import { appendAudit, loadState, saveState } from './store.mjs';
import { nowIso, parseActor, readText, writeText } from './util.mjs';

const ADR_DIR = path.join(META_DIR, 'docs/adr');
const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'];
const TERMINAL = ['superseded'];

async function adrFiles(root) {
  const dir = path.join(root, ADR_DIR);
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return names.map((name) => path.join(dir, name));
}

function parseAdr(text, file) {
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file, '.md');
  const statusBlock = text.match(/^##\s+Status\s*\n+([^\n]+)/m);
  const status = (statusBlock?.[1] ?? 'unknown').trim().split(/[\s(—–-]+/)[0].toLowerCase();
  return { file: path.basename(file), title, status };
}

export async function listAdrs(root) {
  const files = await adrFiles(root);
  const items = [];
  for (const file of files) items.push(parseAdr(await readText(file), file));
  return { items };
}

export async function setAdrStatus(root, target, status, { by, note = null } = {}) {
  if (!target) throw new UsageError('adr needs a number or file (e.g. 0002)');
  if (!by) throw new UsageError('adr needs --by <role>:<name>');
  const normalized = String(status).toLowerCase();
  if (!STATUSES.includes(normalized)) throw new UsageError(`adr status must be one of: ${STATUSES.join(', ')}`);
  const actor = parseActor(by);
  if (!['human', 'architect'].includes(actor.role)) {
    throw new RefusedError('ADR_ROLE', 'only a human or architect may change an ADR status', { by: actor.raw });
  }

  const files = await adrFiles(root);
  const file = files.find((candidate) => path.basename(candidate).startsWith(`${target}-`) || path.basename(candidate) === target);
  if (!file) throw new RefusedError('ADR_UNKNOWN', `no ADR '${target}' under ${ADR_DIR}`, { adr: target });
  const text = await readText(file);
  const current = parseAdr(text, file).status;
  if (current === normalized) return { ...parseAdr(text, file), idempotent: true };
  if (TERMINAL.includes(current)) {
    throw new RefusedError('ADR_TERMINAL', `${path.basename(file)} is superseded and cannot change status`, { adr: target });
  }
  const transitions = {
    proposed: ['accepted', 'rejected', 'superseded'],
    accepted: ['superseded'],
    rejected: ['proposed', 'accepted', 'superseded'],
    superseded: []
  };
  if (current !== 'unknown' && !transitions[current]?.includes(normalized)) {
    throw new RefusedError('ADR_TRANSITION', `${path.basename(file)} cannot go from '${current}' to '${normalized}'`, {
      adr: target,
      from: current,
      to: normalized
    });
  }

  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+Status\s*$/.test(line.trim()));
  if (heading === -1) throw new RefusedError('ADR_STATUS_MISSING', `${path.basename(file)} has no "## Status" section`, { adr: target });
  let index = heading + 1;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  if (index >= lines.length || /^##\s+/.test(lines[index])) {
    lines.splice(heading + 1, 0, '', `${normalized[0].toUpperCase()}${normalized.slice(1)}`);
  } else {
    const suffix = note ? ` — ${String(note).trim()} (${nowIso().slice(0, 10)}, ${actor.raw})` : ` (${nowIso().slice(0, 10)}, ${actor.raw})`;
    lines[index] = `${normalized[0].toUpperCase()}${normalized.slice(1)}${suffix}`;
  }
  await writeText(file, lines.join('\n'));
  const state = await loadState(root);
  appendAudit(state, 'adr.status', actor, { adr: path.basename(file), from: current, status: normalized, note });
  await saveState(root, state);
  return { ...parseAdr(lines.join('\n'), file), idempotent: false, from: current };
}

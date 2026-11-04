import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROLES } from './constants.mjs';
import { UsageError } from './errors.mjs';

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readText(file) {
  return fs.readFile(file, 'utf8');
}

export async function renameWithRetry(from, to, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);
      if (!transient || i === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (i + 1)));
    }
  }
}

export async function writeText(file, text) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await renameWithRetry(tmp, file);
}

export async function readJson(file) {
  return JSON.parse(await readText(file));
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await renameWithRetry(tmp, file);
}

export async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function fileSha256(file) {
  const buffer = await fs.readFile(file);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function normalizeHeading(heading) {
  return String(heading)
    .replace(/^#+\s*/, '')
    .replace(/^\d+(\.\d+)*[.)]?\s*/, '')
    .replace(/^[-*:]\s*/, '')
    .replace(/[：:]+$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function stripHtmlComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, '');
}

export function splitSections(markdown) {
  const lines = stripHtmlComments(markdown).split(/\r?\n/);
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /^(#{2,3})\s+(.*)$/.exec(line);
    if (match && match[1].length === 2) {
      current = {
        title: match[2].trim(),
        key: normalizeHeading(match[2]),
        content: [],
        start: i + 1
      };
      sections.push(current);
    } else if (current) {
      current.content.push(line);
    }
  }
  return sections.map((section) => ({
    ...section,
    content: section.content.join('\n').trim()
  }));
}

export function getSection(sections, name) {
  const key = normalizeHeading(name);
  return sections.find((section) => section.key === key);
}

export function parseMarkdownTable(markdown) {
  const lines = stripHtmlComments(markdown).split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\|/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  const tableLines = [];
  for (let i = start; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) break;
    tableLines.push(lines[i]);
  }
  if (tableLines.length < 2) return null;

  const split = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

  const headers = split(tableLines[0]);
  const separator = tableLines[1];
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(separator)) return null;

  const rows = tableLines.slice(2).map(split);
  return { headers, rows, start, end: start + tableLines.length - 1 };
}

export function parseScope(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return [];
  return [...new Set(
    raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) =>
        part
          .replace(/^\.\//, '')
          .replace(/\/\*\*$/, '')
          .replace(/\/+$/, '')
      )
      .filter(Boolean)
  )];
}

export function normalizeDomain(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

export function covers(prefix, target) {
  const a = normalizeDomain(prefix);
  const b = normalizeDomain(target);
  if (!a || a === '.' || a === '*') return true;
  if (!b) return false;
  return b === a || b.startsWith(`${a}/`);
}

export function isSafeDomain(value) {
  const domain = normalizeDomain(value);
  if (!domain || domain === '.' || domain === '*') return false;
  if (domain.startsWith('/') || domain.includes('\\')) return false;
  if (domain.split('/').some((segment) => segment === '..')) return false;
  if (/[|\n\r]/.test(domain)) return false;
  if (domain.length > 200) return false;
  return true;
}

export function assertMaxLength(value, field, max) {
  const text = String(value ?? '');
  if (text.length > max) {
    throw new UsageError(`--${field} is ${text.length} characters; the limit is ${max}`);
  }
  return text;
}

export function overlaps(a, b) {
  return covers(a, b) || covers(b, a);
}

export function parseActor(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new UsageError('an actor is required (for example human:alice or executor:worker-1)');
  const index = raw.indexOf(':');
  if (index < 0) {
    if (!ROLES.includes(raw)) {
      throw new UsageError(`actor '${raw}' must be <role>:<name> or one of: ${ROLES.join(', ')}`);
    }
    return { role: raw, name: raw, raw };
  }
  const role = raw.slice(0, index).trim();
  const name = raw.slice(index + 1).trim();
  if (!ROLES.includes(role)) {
    throw new UsageError(`unknown role '${role}' (choose: ${ROLES.join(', ')})`);
  }
  if (!name) throw new UsageError(`actor '${raw}' has no name after the colon`);
  return { role, name, raw };
}

export function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasListItem(text) {
  return /^\s*[-*]\s+\S/m.test(String(text ?? ''));
}

export function hasMermaid(text) {
  return /```mermaid\b/.test(String(text ?? ''));
}

export function toPosix(file) {
  return file.split(path.sep).join('/');
}

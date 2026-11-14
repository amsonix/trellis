import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACTS, checkArtifact, readArtifact } from './artifacts.mjs';
import { META_DIR } from './constants.mjs';
import { RefusedError, UsageError } from './errors.mjs';
import { TEMPLATE_DIR, TEMPLATE_MAP } from './project.mjs';
import { getProfile } from './profiles.mjs';
import { appendAudit, loadState, saveState } from './store.mjs';
import { assertMaxLength, exists, nowIso, parseActor, readText, writeText } from './util.mjs';

const ADR_DIR = 'docs/adr';
const ADR_STATUSES = ['proposed', 'accepted', 'superseded'];

function requireArtifact(id) {
  const definition = ARTIFACTS[id];
  if (!definition) {
    throw new UsageError(`unknown document '${id}'; known: ${Object.keys(ARTIFACTS).join(', ')}`);
  }
  return definition;
}

export async function listDocs(root) {
  const state = await loadState(root);
  const profile = getProfile(state.project.profile);
  const items = [];
  for (const definition of Object.values(ARTIFACTS)) {
    const artifact = await readArtifact(root, definition.id);
    items.push({
      id: definition.id,
      title: definition.title,
      path: `${META_DIR}/${definition.path}`,
      stage: definition.stage,
      required: profile.requiredArtifacts.includes(definition.id),
      optional: profile.optionalArtifacts.includes(definition.id),
      exists: !artifact.missing,
      status: artifact.data?.status ?? null
    });
  }
  return { items };
}

export async function showDoc(root, id) {
  const definition = requireArtifact(id);
  const artifact = await readArtifact(root, id);
  return {
    id,
    title: definition.title,
    path: `${META_DIR}/${definition.path}`,
    stage: definition.stage,
    exists: !artifact.missing,
    text: artifact.text ?? null,
    data: artifact.data ?? null
  };
}

export async function checkDoc(root, id) {
  requireArtifact(id);
  const state = await loadState(root);
  const profile = getProfile(state.project.profile);
  return checkArtifact(root, id, profile);
}

export async function scaffoldDoc(root, id, { by } = {}) {
  const definition = requireArtifact(id);
  if (id === 'ADR') throw new UsageError('ADRs are created with "trellis adr new"');
  if (!by) throw new UsageError('doc scaffold needs --by <role>:<name>');
  const actor = parseActor(by);
  if (!['human', 'architect'].includes(actor.role)) {
    throw new RefusedError('DOC_SCAFFOLD_ROLE', 'only a human or architect may scaffold a document', { by: actor.raw });
  }
  const template = Object.entries(TEMPLATE_MAP).find(([, destination]) => destination === definition.path)?.[0];
  if (!template) throw new UsageError(`no template is mapped to ${definition.path}`);
  const target = path.join(root, META_DIR, definition.path);
  if (await exists(target)) {
    throw new RefusedError('ARTIFACT_EXISTS', `${definition.path} already exists`, { path: `${META_DIR}/${definition.path}` });
  }
  const state = await loadState(root);
  const text = (await readText(path.join(TEMPLATE_DIR, template)))
    .replaceAll('{{PROJECT_NAME}}', state.project.name)
    .replaceAll('{{PROFILE}}', state.project.profile)
    .replaceAll('{{DATE}}', nowIso().slice(0, 10));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeText(target, text);
  appendAudit(state, 'doc.scaffolded', actor, { artifact: id, path: `${META_DIR}/${definition.path}` });
  await saveState(root, state);
  return { id, path: `${META_DIR}/${definition.path}`, created: true };
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'decision';
}

export async function createAdr(root, { title, status = 'proposed', by } = {}) {
  if (!title || String(title).trim() === '') throw new UsageError('adr new needs --title "<decision>"');
  assertMaxLength(title, 'title', 200);
  if (!by) throw new UsageError('adr new needs --by <role>:<name>');
  const normalizedStatus = String(status).trim().toLowerCase();
  if (!ADR_STATUSES.includes(normalizedStatus)) {
    throw new UsageError(`--status must be one of: ${ADR_STATUSES.join(', ')}`);
  }
  const actor = parseActor(by);
  if (!['human', 'architect'].includes(actor.role)) {
    throw new RefusedError('ADR_ROLE', 'only a human or architect may create an ADR', { by: actor.raw });
  }

  const dir = path.join(root, META_DIR, ADR_DIR);
  await fs.mkdir(dir, { recursive: true });
  const names = (await fs.readdir(dir)).filter((name) => /^\d{4}-.*\.md$/.test(name));
  const next = names.reduce((max, name) => Math.max(max, Number.parseInt(name.slice(0, 4), 10)), 0) + 1;
  const number = String(next).padStart(4, '0');
  const file = path.join(dir, `${number}-${slugify(title)}.md`);
  if (await exists(file)) throw new RefusedError('ADR_EXISTS', `${ADR_DIR}/${path.basename(file)} already exists`);

  const template = await readText(path.join(TEMPLATE_DIR, 'ADR-0001.md'));
  const text = template
    .replace('# ADR 0001: Record architecture decisions', `# ADR ${number}: ${String(title).trim()}`)
    .replace('## Status\n\nAccepted', `## Status\n\n${normalizedStatus[0].toUpperCase()}${normalizedStatus.slice(1)}`);
  await writeText(file, text);

  const state = await loadState(root);
  appendAudit(state, 'adr.created', actor, { path: `${META_DIR}/${ADR_DIR}/${path.basename(file)}`, title: String(title).trim(), status: normalizedStatus });
  await saveState(root, state);
  return { number, path: `${META_DIR}/${ADR_DIR}/${path.basename(file)}`, title: String(title).trim(), status: normalizedStatus, created: true };
}

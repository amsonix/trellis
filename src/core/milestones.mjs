import path from 'node:path';
import { META_DIR } from './constants.mjs';
import { RefusedError, UsageError } from './errors.mjs';
import { appendAudit, loadState, saveState } from './store.mjs';
import { milestonesFromRoadmap, parseTasks } from './tasks.mjs';
import { assertMaxLength, nowIso, parseActor, readText, writeText } from './util.mjs';

const ROADMAP = path.join(META_DIR, 'docs/ROADMAP.md');
const CLOSED = ['done', 'canceled'];
const DECLARED = ['planned', 'active', 'done'];

export function milestoneProgress(milestones, tasks) {
  return milestones.map((milestone) => {
    const items = tasks.filter((task) => task.milestone === milestone.id);
    const done = items.filter((task) => task.status === 'done').length;
    const active = items.some((task) => ['in_progress', 'review'].includes(task.status) || task.status === 'done');
    const computed = items.length === 0 ? 'empty' : done === items.length ? 'done' : active ? 'in_progress' : 'todo';
    return {
      id: milestone.id,
      title: milestone.title,
      computed,
      declared: DECLARED.includes(milestone.declared) ? milestone.declared : 'unknown',
      ready: computed === 'done' && milestone.declared !== 'done',
      mismatch: milestone.declared === 'done' && computed !== 'done',
      tasks: { done, total: items.length }
    };
  });
}

export async function listMilestones(root) {
  const { tasks } = await parseTasks(root);
  return milestoneProgress(await milestonesFromRoadmap(root), tasks);
}

export async function getMilestone(root, id) {
  const items = await listMilestones(root);
  const milestone = items.find((item) => item.id === id);
  if (!milestone) throw new RefusedError('MILESTONE_UNKNOWN', `no milestone '${id}' in ${ROADMAP}`, { milestone: id });
  return milestone;
}

function statusLine(status, actor, note) {
  const suffix = note ? ` — ${String(note).trim()}` : '';
  return `**Status:** ${status} (${nowIso().slice(0, 10)}, ${actor.raw})${suffix}`;
}

export async function setMilestoneStatus(root, id, status, { by, note = null, reason = null } = {}) {
  if (!id) throw new UsageError('milestone needs an id (M0, M1, ...)');
  if (!by) throw new UsageError('milestone needs --by <role>:<name>');
  if (!DECLARED.includes(status)) throw new UsageError(`milestone status must be one of: ${DECLARED.join(', ')}`);
  if (note !== null) assertMaxLength(note, 'note', 1000);
  const actor = parseActor(by);
  if (!['human', 'coordinator'].includes(actor.role)) {
    throw new RefusedError('MILESTONE_ROLE', 'only a human or coordinator may change a milestone status', { by: actor.raw });
  }

  const progress = await getMilestone(root, id);
  if (status === 'done') {
    const { tasks } = await parseTasks(root);
    const open = tasks.filter((task) => task.milestone === id && !CLOSED.includes(task.status));
    if (open.length > 0) {
      throw new RefusedError('MILESTONE_OPEN_TASKS', `${id} has open task(s): ${open.map((task) => task.id).join(', ')}`, {
        milestone: id,
        tasks: open.map((task) => task.id)
      });
    }
  }
  if (progress.declared === status) {
    return { milestone: progress, idempotent: true };
  }

  const file = path.join(root, ROADMAP);
  const lines = (await readText(file)).split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${id}\\b`).test(line));
  if (start === -1) throw new RefusedError('MILESTONE_UNKNOWN', `no heading '## ${id}' in ${ROADMAP}`, { milestone: id });
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  const line = statusLine(status, actor, note ?? reason);
  let replaced = false;
  for (let i = start + 1; i < end; i += 1) {
    if (/^\*\*Status:\*\*/i.test(lines[i].trim())) {
      lines[i] = line;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    lines.splice(start + 1, 0, '', line);
  }
  await writeText(file, lines.join('\n'));
  const state = await loadState(root);
  appendAudit(state, status === 'done' ? 'milestone.closed' : 'milestone.status', actor, {
    milestone: id,
    status,
    note: note ?? reason
  });
  await saveState(root, state);
  return { milestone: await getMilestone(root, id), idempotent: false };
}

export async function closeMilestone(root, id, { by, note } = {}) {
  return setMilestoneStatus(root, id, 'done', { by, note });
}

export async function reopenMilestone(root, id, { by, note } = {}) {
  return setMilestoneStatus(root, id, 'active', { by, note });
}

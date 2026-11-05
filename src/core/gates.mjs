import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GATE_DEFS, PROJECT_GATES, META_DIR } from './constants.mjs';
import { makeCheck, summarize } from './checks.mjs';
import { checkArtifact, ARTIFACTS } from './artifacts.mjs';
import { validateTasks, milestonesFromRoadmap, taskById, parseTasks } from './tasks.mjs';
import { verifyTaskEvidence } from './evidence.mjs';
import { loadState, saveState, appendAudit } from './store.mjs';
import { getProfile } from './profiles.mjs';
import { RefusedError, UsageError } from './errors.mjs';
import { nowIso, parseActor, readText } from './util.mjs';

export const GATE_DEPENDENCIES = {
  G0: ['PROJECT'],
  G1: ['RESEARCH'],
  G2: ['ARCHITECTURE', 'ADR'],
  G3: ['ROADMAP', 'TASKS', 'VERIFICATION'],
  G4: ['ROADMAP', 'TASKS'],
  G5: [],
  G6: ['TASKS', 'VERIFICATION'],
  G7: ['OPERATIONS']
};

export function normalizeArtifact(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function adrDigest(root) {
  const dir = path.join(root, META_DIR, 'docs/adr');
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const parts = [];
  for (const name of names) {
    const text = await readText(path.join(dir, name));
    parts.push(`${name}\n${normalizeArtifact(text)}`);
  }
  return parts.join('\n');
}

export async function gateDigest(root, gateId, { legacy = false } = {}) {
  const dependencies = GATE_DEPENDENCIES[gateId] ?? GATE_DEFS[gateId]?.artifacts ?? [];
  const files = {};
  const structures = {};
  const hash = crypto.createHash('sha256');
  for (const artifactId of dependencies) {
    let text = 'MISSING';
    if (artifactId === 'TASKS') {
      // The content digest covers prose (title, acceptance, verification); the
      // structure digest covers only what changes the plan: ids, milestones,
      // roles, scopes and dependencies. Status churn is execution, not plan.
      const parsed = await parseTasks(root);
      if (!parsed.error) {
        // Canonical order makes moving a row between board sections a no-op.
        // `legacy` preserves arrival order so approvals made before this rule
        // do not go stale on the upgrade.
        const tasks = legacy
          ? parsed.tasks
          : [...parsed.tasks].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
        text = JSON.stringify(
          tasks.map((task) => ({
            id: task.id,
            milestone: task.milestone,
            title: task.title,
            role: task.role,
            scope: task.scope,
            dependsOn: task.dependsOn,
            acceptance: task.acceptance,
            verification: task.verification
          }))
        );
        structures.TASKS = crypto
          .createHash('sha256')
          .update(
            JSON.stringify(
              tasks.map((task) => ({
                id: task.id,
                milestone: task.milestone,
                role: task.role,
                scope: task.scope,
                dependsOn: task.dependsOn
              }))
            )
          )
          .digest('hex');
      }
    } else if (artifactId === 'ROADMAP') {
      const file = path.join(root, META_DIR, 'docs/ROADMAP.md');
      try {
        text = normalizeArtifact(await readText(file));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const milestones = await milestonesFromRoadmap(root);
      structures.ROADMAP = crypto
        .createHash('sha256')
        .update(
          JSON.stringify(
            milestones.map((milestone) => ({
              id: milestone.id,
              bullets: milestone.content
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => /^[-*]\s+/.test(line))
            }))
          )
        )
        .digest('hex');
    } else if (artifactId === 'ADR') {
      text = await adrDigest(root);
    } else {
      const definition = ARTIFACTS[artifactId];
      if (!definition) continue;
      const file = path.join(root, META_DIR, definition.path);
      try {
        text = normalizeArtifact(await readText(file));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const fileHash = crypto.createHash('sha256').update(text).digest('hex');
    files[artifactId] = fileHash;
    hash.update(`${artifactId}:${fileHash}\n`);
  }
  return { hash: hash.digest('hex'), files, structures };
}

export async function gateChanges(root, state) {
  const stale = [];
  const drift = [];
  for (const gateId of PROJECT_GATES) {
    const gate = state.gates?.[gateId];
    if (!gate || gate.status !== 'passed' || !gate.digest?.files) continue;
    const current = await gateDigest(root, gateId);
    const previous = await gateDigest(root, gateId, { legacy: true });
    const changed = Object.keys({ ...gate.digest.files, ...current.files }).filter(
      (artifactId) =>
        gate.digest.files[artifactId] !== current.files[artifactId] &&
        gate.digest.files[artifactId] !== previous.files[artifactId]
    );
    if (changed.length === 0) continue;
    const structureChanged = changed.some((artifactId) => {
      const before = gate.digest.structures?.[artifactId];
      const after = current.structures?.[artifactId];
      const oldOrder = previous.structures?.[artifactId];
      if (before === undefined || after === undefined) return true;
      return before !== after && before !== oldOrder;
    });
    (structureChanged ? stale : drift).push({ gate: gateId, changed });
  }
  return { stale, drift };
}

export async function staleGates(root, state) {
  return (await gateChanges(root, state)).stale;
}

export async function driftedGates(root, state) {
  return (await gateChanges(root, state)).drift;
}

export function gateSatisfied(state, gateId) {
  const gate = state.gates?.[gateId];
  return gate?.status === 'passed' || gate?.status === 'waived';
}

export function taskGateSatisfied(state, taskId) {
  const gate = state.taskGates?.[taskId];
  return gate?.status === 'passed' || gate?.status === 'waived';
}

export function firstUnsatisfiedProjectGate(state) {
  return PROJECT_GATES.find((id) => !gateSatisfied(state, id)) ?? null;
}

export function previousGatePending(state, gateId) {
  if (gateId === 'G5' || !PROJECT_GATES.includes(gateId)) return null;
  const index = PROJECT_GATES.indexOf(gateId);
  for (const id of PROJECT_GATES.slice(0, index)) {
    if (!gateSatisfied(state, id)) return id;
  }
  return null;
}

export function computeStage(state, tasks) {
  if (gateSatisfied(state, 'G7')) return 'maintained';
  if (gateSatisfied(state, 'G6')) return 'releasing';
  if (gateSatisfied(state, 'G4')) {
    if (tasks.length > 0 && tasks.every((task) => task.status === 'done')) return 'integrating';
    return 'executing';
  }
  for (const id of ['G0', 'G1', 'G2', 'G3', 'G4']) {
    if (!gateSatisfied(state, id)) return GATE_DEFS[id].stage;
  }
  return 'ready';
}

export function gateSummary(state) {
  const summary = {};
  for (const id of Object.keys(GATE_DEFS)) {
    summary[id] = {
      id,
      title: GATE_DEFS[id].title,
      status: state.gates?.[id]?.status ?? 'pending',
      approvedBy: state.gates?.[id]?.approvedBy ?? null,
      at: state.gates?.[id]?.at ?? null,
      note: state.gates?.[id]?.note ?? null
    };
  }
  return summary;
}

export async function gateChecks(root, gateId, { profile, state, tasks, taskId = null }) {
  const definition = GATE_DEFS[gateId];
  if (!definition) throw new UsageError(`unknown gate '${gateId}'`);
  const checks = [];

  for (const artifactId of definition.artifacts ?? []) {
    checks.push(...(await checkArtifact(root, artifactId, profile)));
  }

  if (gateId === 'G4') {
    const milestones = await milestonesFromRoadmap(root);
    checks.push(...validateTasks(tasks, { milestones }));
  }

  if (gateId === 'G5') {
    if (!taskId) throw new UsageError('G5 is a per-task gate; pass --task <T-NNN>');
    const task = taskById(tasks, taskId);
    if (!task) {
      checks.push(makeCheck('TASK_UNKNOWN', 'fail', `task ${taskId} is not on the task board`, { stage: 'executing', task: taskId }));
    } else {
      if (!['review', 'done'].includes(task.status)) {
        checks.push(
          makeCheck('TASK_NOT_READY_FOR_REVIEW', 'fail', `task ${taskId} is '${task.status}', not 'review'`, {
            stage: 'executing',
            task: taskId
          })
        );
      }
      checks.push(...(await verifyTaskEvidence(root, taskId)));
    }
  }

  if (gateId === 'G6') {
    if (tasks.length === 0) {
      checks.push(makeCheck('TASKS_EMPTY', 'fail', 'no tasks to integrate', { stage: 'integrating' }));
    }
    for (const task of tasks) {
      if (task.status === 'canceled') {
        checks.push(
          makeCheck('TASK_CANCELED', 'warn', `task ${task.id} was canceled and is excluded from integration`, {
            stage: 'integrating',
            task: task.id
          })
        );
        continue;
      }
      if (task.status !== 'done') {
        checks.push(
          makeCheck('TASK_NOT_DONE', 'fail', `task ${task.id} is '${task.status}', not 'done'`, {
            stage: 'integrating',
            task: task.id
          })
        );
      }
      checks.push(...(await verifyTaskEvidence(root, task.id)));
      if (!taskGateSatisfied(state, task.id)) {
        checks.push(
          makeCheck('TASK_REVIEW_MISSING', 'fail', `task ${task.id} has not passed G5`, {
            stage: 'integrating',
            task: task.id
          })
        );
      }
    }
  }

  if (gateId === 'G7') {
    const operationsRequired = profile.requiredArtifacts.includes('OPERATIONS');
    if (!operationsRequired) {
      checks.push(
        makeCheck('OPERATIONS_OPTIONAL', 'warn', `${profile.id} does not require OPERATIONS; release checks are limited`, {
          stage: 'releasing'
        })
      );
    }
  }

  return checks;
}

export async function approveGate(root, gateId, { by, note = null, taskId = null }) {
  const definition = GATE_DEFS[gateId];
  if (!definition) throw new UsageError(`unknown gate '${gateId}'`);
  const actor = parseActor(by);
  if (!definition.approvers.includes(actor.role)) {
    throw new RefusedError(
      'GATE_APPROVER',
      `${actor.raw} cannot approve ${gateId}; allowed: ${definition.approvers.join(', ')}`,
      { gate: gateId, actor: actor.raw, allowed: definition.approvers }
    );
  }

  const state = await loadState(root);
  const profile = getProfile(state.project.profile);
  const stale = await staleGates(root, state);

  if (gateId === 'G5') {
    if (!taskId) throw new UsageError('G5 is a per-task gate; pass --task <T-NNN>');
    if (!gateSatisfied(state, 'G4')) {
      throw new RefusedError('GATE_OUT_OF_ORDER', 'G5 cannot be approved before G4', {
        gate: 'G5',
        previous: 'G4'
      });
    }
    const existing = state.taskGates?.[taskId];
    if (existing?.status === 'passed' || existing?.status === 'waived') {
      throw new RefusedError('GATE_ALREADY_SATISFIED', `${gateId} for ${taskId} is already ${existing.status}`, { gate: gateId, task: taskId });
    }
  } else {
    const gate = state.gates[gateId];
    const isStale = stale.some((item) => item.gate === gateId);
    if ((gate.status === 'passed' || gate.status === 'waived') && !isStale) {
      throw new RefusedError('GATE_ALREADY_SATISFIED', `${gateId} is already ${gate.status}`, { gate: gateId });
    }
    if (!isStale) {
      const previous = previousGatePending(state, gateId);
      if (previous) {
        throw new RefusedError('GATE_OUT_OF_ORDER', `${gateId} cannot be approved before ${previous}`, {
          gate: gateId,
          previous
        });
      }
    }
  }

  // Only earlier gates may block: re-approval happens in order, and two stale
  // gates that share artifacts must not deadlock each other.
  const targetGate = gateId === 'G5' ? 'G4' : gateId;
  const targetIndex = PROJECT_GATES.indexOf(targetGate);
  const blockingStale = stale.filter((item) => {
    const index = PROJECT_GATES.indexOf(item.gate);
    return index !== -1 && targetIndex !== -1 && index < targetIndex;
  });
  if (blockingStale.length > 0) {
    throw new RefusedError(
      'GATE_STALE',
      `${gateId} cannot be approved while ${blockingStale.map((item) => item.gate).join(', ')} is stale; re-approve it first`,
      { gate: gateId, stale: blockingStale }
    );
  }

  const { tasks } = await parseTasks(root);
  const checks = await gateChecks(root, gateId, { profile, state, tasks, taskId });
  const blocking = checks.filter((check) => check.severity === 'fail' || check.severity === 'unavailable');
  if (blocking.length > 0) {
    throw new RefusedError(
      'GATE_BLOCKED',
      `${gateId} is blocked: ${blocking.map((check) => check.message).join('; ')}`,
      { gate: gateId, checks, summary: summarize(checks) }
    );
  }

  if (gateId === 'G5') {
    state.taskGates[taskId] = {
      id: 'G5',
      taskId,
      status: 'passed',
      approvedBy: actor.raw,
      at: nowIso(),
      note
    };
  } else {
    state.gates[gateId] = {
      ...state.gates[gateId],
      status: 'passed',
      approvedBy: actor.raw,
      at: nowIso(),
      note,
      digest: await gateDigest(root, gateId)
    };
  }
  appendAudit(state, `gate.${gateId}.passed`, actor, { note, taskId });
  await saveState(root, state);
  return { gate: gateId, taskId, status: 'passed', approvedBy: actor.raw, checks };
}

export async function waiveGate(root, gateId, { by, reason, taskId = null }) {
  const definition = GATE_DEFS[gateId];
  if (!definition) throw new UsageError(`unknown gate '${gateId}'`);
  const actor = parseActor(by);
  if (actor.role !== 'human') {
    throw new RefusedError('GATE_WAIVER_APPROVER', 'only a human can waive a gate', { gate: gateId, actor: actor.raw });
  }
  if (!reason) throw new UsageError('a waiver needs --reason "<why>"');

  const state = await loadState(root);
  if (gateId === 'G5') {
    if (!taskId) throw new UsageError('G5 is a per-task gate; pass --task <T-NNN>');
    state.taskGates[taskId] = {
      id: 'G5',
      taskId,
      status: 'waived',
      approvedBy: actor.raw,
      at: nowIso(),
      reason
    };
  } else {
    state.gates[gateId] = {
      ...state.gates[gateId],
      status: 'waived',
      approvedBy: actor.raw,
      at: nowIso(),
      reason
    };
  }
  appendAudit(state, `gate.${gateId}.waived`, actor, { reason, taskId });
  await saveState(root, state);
  return { gate: gateId, taskId, status: 'waived', approvedBy: actor.raw, reason };
}

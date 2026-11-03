import { GATE_DEFS, PROJECT_GATES } from './constants.mjs';
import { makeCheck, summarize } from './checks.mjs';
import { checkArtifact } from './artifacts.mjs';
import { validateTasks, milestonesFromRoadmap, taskById, parseTasks } from './tasks.mjs';
import { verifyTaskEvidence } from './evidence.mjs';
import { loadState, saveState, appendAudit } from './store.mjs';
import { getProfile } from './profiles.mjs';
import { RefusedError, UsageError } from './errors.mjs';
import { nowIso, parseActor } from './util.mjs';

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

  if (gateId === 'G5') {
    if (!taskId) throw new UsageError('G5 is a per-task gate; pass --task <T-NNN>');
    const existing = state.taskGates?.[taskId];
    if (existing?.status === 'passed' || existing?.status === 'waived') {
      throw new RefusedError('GATE_ALREADY_SATISFIED', `${gateId} for ${taskId} is already ${existing.status}`, { gate: gateId, task: taskId });
    }
  } else {
    const gate = state.gates[gateId];
    if (gate.status === 'passed' || gate.status === 'waived') {
      throw new RefusedError('GATE_ALREADY_SATISFIED', `${gateId} is already ${gate.status}`, { gate: gateId });
    }
    const previous = previousGatePending(state, gateId);
    if (previous) {
      throw new RefusedError('GATE_OUT_OF_ORDER', `${gateId} cannot be approved before ${previous}`, {
        gate: gateId,
        previous
      });
    }
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
      note
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

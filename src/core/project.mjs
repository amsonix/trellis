import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_TRANSITIONS, GATE_DEFS, META_DIR } from './constants.mjs';
import { makeCheck, summarize, hasBlocking, exitCodeFor } from './checks.mjs';
import { getProfile, listProfiles } from './profiles.mjs';
import { checkAllArtifacts, readArtifact } from './artifacts.mjs';
import { parseTasks, validateTasks, milestonesFromRoadmap, taskById, readyTasks, updateTaskStatus } from './tasks.mjs';
import {
  approveGate,
  waiveGate,
  computeStage,
  gateChecks,
  gateSummary,
  gateSatisfied,
  taskGateSatisfied,
  firstUnsatisfiedProjectGate
} from './gates.mjs';
import { addEvidence, verifyTaskEvidence, requirePassingEvidence, listEvidence } from './evidence.mjs';
import { acquireLease, releaseLease, leaseStatus } from './lease.mjs';
import { defaultState, loadState, saveState, appendAudit } from './store.mjs';
import { RefusedError, UnavailableError, UsageError } from './errors.mjs';
import { nowIso, parseActor, writeText } from './util.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'templates');
const SKILL_SOURCE = path.join(PACKAGE_ROOT, 'skills', 'trellis', 'SKILL.md');

const TEMPLATE_MAP = {
  'README.md': 'README.md',
  'PROJECT.md': 'PROJECT.md',
  'RESEARCH.md': 'docs/RESEARCH.md',
  'ARCHITECTURE.md': 'docs/ARCHITECTURE.md',
  'ROADMAP.md': 'docs/ROADMAP.md',
  'TASKS.md': 'docs/TASKS.md',
  'VERIFICATION.md': 'docs/VERIFICATION.md',
  'OPERATIONS.md': 'docs/OPERATIONS.md',
  'GLOSSARY.md': 'docs/GLOSSARY.md',
  'INVARIANTS.md': 'docs/INVARIANTS.md',
  'ADR-0001.md': 'docs/adr/0001-record-architecture-decisions.md'
};

export { listProfiles };

export async function initProject({ dir, name = null, profile: profileId = 'generic' }) {
  const root = path.resolve(dir);
  const profile = getProfile(profileId);
  const projectName = name || path.basename(root) || 'project';
  if (!root || root === '/') throw new UsageError('refusing to initialise the filesystem root');

  // The management directory is fixed: <project>/.trellis/.
  // init may run on an existing project: it only creates that directory and
  // never touches README.md, TASKS.md, docs/ or any other existing file.
  const meta = path.join(root, META_DIR);
  let entries = [];
  try {
    entries = await fs.readdir(meta);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (entries.length > 0) {
    throw new RefusedError('ALREADY_INITIALIZED', `${root} already has a non-empty ${META_DIR}/ management directory`, {
      dir: root,
      managementDir: meta,
      entries: entries.slice(0, 10)
    });
  }

  await fs.mkdir(path.join(meta, 'docs/adr'), { recursive: true });

  const created = [];
  const today = nowIso().slice(0, 10);
  for (const [template, destination] of Object.entries(TEMPLATE_MAP)) {
    const source = path.join(TEMPLATE_DIR, template);
    const target = path.join(meta, destination);
    const text = await fs.readFile(source, 'utf8');
    const rendered = text
      .replaceAll('{{PROJECT_NAME}}', projectName)
      .replaceAll('{{PROFILE}}', profile.id)
      .replaceAll('{{DATE}}', today);
    await writeText(target, rendered);
    created.push(`${META_DIR}/${destination}`);
  }

  const state = defaultState({ name: projectName, profile: profile.id });
  appendAudit(state, 'project.init', null, { dir: root, managementDir: meta, profile: profile.id });
  await saveState(root, state);

  // The agent skill is written once, next to .trellis/, and never overwritten.
  // A missing skill source is not fatal: init must still work from a package
  // that was built without it.
  const skillTarget = path.join(root, '.agents', 'skills', 'trellis', 'SKILL.md');
  let skill = null;
  try {
    skill = await fs.readFile(SKILL_SOURCE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (skill !== null) {
    await fs.mkdir(path.dirname(skillTarget), { recursive: true });
    try {
      await fs.writeFile(skillTarget, skill, { encoding: 'utf8', flag: 'wx' });
      created.push('.agents/skills/trellis/SKILL.md');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  return {
    dir: root,
    managementDir: meta,
    name: projectName,
    profile: profile.id,
    created,
    next: [
      `cd ${root}`,
      `read ${META_DIR}/PROJECT.md and fill the scope, non-goals and acceptance`,
      `run: trellis check --dir ${root}`,
      'run: trellis gate G0 --approve --by human:<you>'
    ]
  };
}

export async function runChecks(root, stage = null) {
  const state = await loadState(root);
  const profile = getProfile(state.project.profile);
  const checks = [];

  checks.push(
    makeCheck('STATE_OK', 'pass', `state schema ${state.schemaVersion}, profile ${profile.id}`, {
      stage: computeStage(state, [])
    })
  );

  checks.push(...(await checkAllArtifacts(root, profile)));

  const parsed = await parseTasks(root);
  if (parsed.error) {
    checks.push(
      makeCheck('TASKS_PARSE', 'unavailable', parsed.error.message, {
        stage: 'plan',
        codeDetail: parsed.error.code,
        headers: parsed.error.headers
      })
    );
  } else {
    const milestones = await milestonesFromRoadmap(root);
    const taskChecks = validateTasks(parsed.tasks, { milestones });
    checks.push(...taskChecks);
    if (!taskChecks.some((check) => check.severity === 'fail' || check.severity === 'unavailable')) {
      checks.push(makeCheck('TASKS_VALID', 'pass', `${parsed.tasks.length} task(s) form a valid graph`, { stage: 'ready' }));
    }
  }

  const filtered = stage ? checks.filter((check) => check.stage === stage) : checks;
  const summary = summarize(filtered);
  return {
    project: { name: state.project.name, profile: state.project.profile },
    stage: computeStage(state, parsed.tasks ?? []),
    checks: filtered,
    summary,
    exitCode: exitCodeFor(filtered)
  };
}

function taskCounts(tasks) {
  const counts = { total: tasks.length, todo: 0, ready: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return counts;
}

async function buildAttention(root, state, tasks, checks) {
  const attention = [];
  for (const check of checks) {
    if (check.severity === 'fail' || check.severity === 'unavailable') {
      attention.push({ kind: 'check', code: check.code, message: check.message, artifact: check.artifact ?? null, task: check.task ?? null });
    }
  }
  for (const task of tasks) {
    if (task.status === 'blocked') {
      const note = state.taskNotes?.[task.id]?.note;
      attention.push({
        kind: 'task',
        code: 'TASK_BLOCKED',
        message: `${task.id} is blocked${note ? `: ${note}` : ''}`,
        task: task.id
      });
    }
    if (task.status === 'review') {
      const evidence = await verifyTaskEvidence(root, task.id);
      if (evidence.some((check) => check.severity === 'fail')) {
        attention.push({
          kind: 'task',
          code: 'TASK_REVIEW_WITHOUT_EVIDENCE',
          message: `${task.id} is in review but its evidence does not pass`,
          task: task.id
        });
      }
    }
  }
  const pendingTaskGate = tasks.find((task) => ['review', 'done'].includes(task.status) && !taskGateSatisfied(state, task.id));
  if (pendingTaskGate) {
    attention.push({
      kind: 'gate',
      code: 'GATE_PENDING',
      message: `G5 (Task review) is pending for ${pendingTaskGate.id}`,
      gate: 'G5',
      task: pendingTaskGate.id
    });
  }
  const gate = firstUnsatisfiedProjectGate(state);
  if (gate) {
    attention.push({
      kind: 'gate',
      code: 'GATE_PENDING',
      message: `${gate} (${GATE_DEFS[gate]?.title ?? ''}) is pending`,
      gate
    });
  }
  return attention;
}

async function nextFrom(root, state, tasks, checks, role = null) {
  const stage = computeStage(state, tasks);

  // While G4 is satisfied and G6 is not, execution is the work. A reviewer can
  // ask for --role reviewer to see the per-task review gate instead.
  if (gateSatisfied(state, 'G4') && !gateSatisfied(state, 'G6') && stage === 'executing') {
    const ready = readyTasks(tasks, role);
    if (ready.length > 0) {
      return {
        kind: 'tasks',
        tasks: ready.map(({ id, title, role: taskRole, scope, acceptance }) => ({ id, title, role: taskRole, scope, acceptance }))
      };
    }
    const active = tasks.filter((task) => task.status === 'in_progress' && (!role || task.role === role));
    if (active.length > 0) {
      return {
        kind: 'tasks',
        tasks: active.map(({ id, title, role: taskRole, scope, acceptance }) => ({ id, title, role: taskRole, scope, acceptance })),
        note: 'in progress'
      };
    }
    const reviewed = tasks.find((task) => ['review', 'done'].includes(task.status) && !taskGateSatisfied(state, task.id));
    if (reviewed) {
      return {
        kind: 'gate',
        gate: { id: 'G5', title: GATE_DEFS.G5.title, task: reviewed.id },
        checks: [],
        summary: { pass: 0, warn: 0, fail: 0, unavailable: 0, total: 0 },
        command: `trellis gate G5 --task ${reviewed.id} --approve --by reviewer:<name>`
      };
    }
    return { kind: 'waiting', attention: await buildAttention(root, state, tasks, checks) };
  }

  // A done task still needs its per-task review before integration.
  if (gateSatisfied(state, 'G4') && !gateSatisfied(state, 'G6')) {
    const reviewed = tasks.find((task) => ['review', 'done'].includes(task.status) && !taskGateSatisfied(state, task.id));
    if (reviewed) {
      return {
        kind: 'gate',
        gate: { id: 'G5', title: GATE_DEFS.G5.title, task: reviewed.id },
        checks: [],
        summary: { pass: 0, warn: 0, fail: 0, unavailable: 0, total: 0 },
        command: `trellis gate G5 --task ${reviewed.id} --approve --by reviewer:<name>`
      };
    }
  }

  const gate = firstUnsatisfiedProjectGate(state);
  if (gate) {
    const profile = getProfile(state.project.profile);
    const gateChecksResult = await gateChecks(root, gate, { profile, state, tasks });
    return {
      kind: 'gate',
      gate: { ...state.gates[gate], id: gate, title: GATE_DEFS[gate]?.title ?? gate },
      checks: gateChecksResult,
      summary: summarize(gateChecksResult),
      command: `trellis gate ${gate} --approve --by <role>:<name>`
    };
  }
  return { kind: 'waiting', attention: await buildAttention(root, state, tasks, checks) };
}

export async function projectStatus(root) {
  const state = await loadState(root);
  const parsed = await parseTasks(root);
  const tasks = parsed.tasks ?? [];
  const checksResult = await runChecks(root);
  const attention = await buildAttention(root, state, tasks, checksResult.checks);
  const next = await nextFrom(root, state, tasks, checksResult.checks);
  const leases = await leaseStatus(root);
  const gates = gateSummary(state);
  if (tasks.length > 0) {
    const taskGateStates = tasks.map((task) => state.taskGates?.[task.id]?.status ?? 'pending');
    const g5Passed = taskGateStates.every((status) => status === 'passed' || status === 'waived');
    gates.G5 = {
      ...gates.G5,
      status: g5Passed ? 'passed' : 'pending',
      approvedBy: g5Passed ? tasks.map((task) => state.taskGates?.[task.id]?.approvedBy).filter(Boolean).join(', ') : null
    };
  }
  return {
    project: { name: state.project.name, profile: state.project.profile },
    stage: computeStage(state, tasks),
    gates,
    taskGates: state.taskGates,
    tasks: taskCounts(tasks),
    checks: { summary: checksResult.summary, blocking: checksResult.checks.filter((check) => hasBlocking([check])) },
    attention,
    leases,
    next
  };
}

export async function nextAction(root, role = null) {
  const state = await loadState(root);
  const parsed = await parseTasks(root);
  const tasks = parsed.tasks ?? [];
  const checksResult = await runChecks(root);
  return nextFrom(root, state, tasks, checksResult.checks, role);
}

export async function claimTask(root, taskId, { by }) {
  const actor = parseActor(by);
  const state = await loadState(root);
  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  if (task.status === 'in_progress') {
    const lease = (await leaseStatus(root)).find((item) => item.taskId === taskId);
    if (lease) return { task, lease, idempotent: true };
  }
  if (!['todo', 'ready'].includes(task.status)) {
    throw new RefusedError('TASK_NOT_CLAIMABLE', `task ${taskId} is '${task.status}', not todo/ready`, { task: taskId });
  }
  if (actor.role !== task.role && !['coordinator', 'human'].includes(actor.role)) {
    throw new RefusedError('TASK_ROLE', `${actor.raw} cannot claim ${taskId}; it is assigned to ${task.role}`, {
      task: taskId,
      role: task.role
    });
  }
  const done = new Set(tasks.filter((item) => item.status === 'done').map((item) => item.id));
  const waitingOn = task.dependsOn.filter((dependency) => !done.has(dependency));
  if (waitingOn.length > 0) {
    throw new RefusedError('TASK_BLOCKED_BY_DEPENDENCY', `task ${taskId} waits on ${waitingOn.join(', ')}`, {
      task: taskId,
      waitingOn
    });
  }

  const lease = await acquireLease(root, { taskId, actor: actor.raw, domains: task.scope });
  await updateTaskStatus(root, taskId, 'in_progress');
  appendAudit(state, 'task.claimed', actor, { task: taskId, lease: lease.id });
  await saveState(root, state);
  return { task: { ...task, status: 'in_progress' }, lease };
}

export async function reportTask(root, taskId, { state: newStatus, note = null, by }) {
  if (!newStatus) throw new UsageError('task report needs --state <status>');
  const actor = by ? parseActor(by) : null;
  const state = await loadState(root);
  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  if (task.status === newStatus) {
    return { task, idempotent: true };
  }
  const allowed = TASK_TRANSITIONS[task.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new RefusedError('TASK_TRANSITION', `task ${taskId} cannot go from '${task.status}' to '${newStatus}'`, {
      task: taskId,
      from: task.status,
      to: newStatus,
      allowed
    });
  }

  let evidence = null;
  if (newStatus === 'done') {
    evidence = await requirePassingEvidence(root, taskId);
    await releaseLease(root, taskId);
  }

  await updateTaskStatus(root, taskId, newStatus);
  state.taskNotes = state.taskNotes ?? {};
  state.taskNotes[taskId] = { note, at: nowIso(), by: actor?.raw ?? null, state: newStatus };
  appendAudit(state, `task.${newStatus}`, actor, { task: taskId, note });
  await saveState(root, state);
  return { task: { ...task, status: newStatus }, evidence };
}

export async function addTaskEvidence(root, input) {
  const record = await addEvidence(root, input);
  const state = await loadState(root);
  appendAudit(state, 'evidence.added', input.by ?? null, { task: input.taskId, evidence: record.id });
  await saveState(root, state);
  return record;
}

export async function verifyTask(root, taskId) {
  const checks = await verifyTaskEvidence(root, taskId);
  return { taskId, checks, summary: summarize(checks), exitCode: exitCodeFor(checks) };
}

export async function evidenceFor(root, taskId = null) {
  return listEvidence(root, taskId);
}

export async function reindex(root) {
  let state;
  try {
    state = await loadState(root);
  } catch (error) {
    if (!(error instanceof UnavailableError)) throw error;
    const project = await readArtifact(root, 'PROJECT');
    if (project.missing) {
      throw new UnavailableError('cannot reindex: ${META_DIR}/PROJECT.md is missing and there is no state to recover from', { dir: root });
    }
    state = defaultState({
      name: project.data?.project || path.basename(root),
      profile: project.data?.profile || 'web-app'
    });
  }

  const project = await readArtifact(root, 'PROJECT');
  if (!project.missing) {
    if (project.data?.project) state.project.name = String(project.data.project);
    if (project.data?.profile) state.project.profile = String(project.data.profile);
  }
  const parsed = await parseTasks(root);
  const tasks = parsed.tasks ?? [];
  appendAudit(state, 'project.reindex', null, {
    tasks: tasks.length,
    stage: computeStage(state, tasks)
  });
  await saveState(root, state);
  return {
    project: { name: state.project.name, profile: state.project.profile },
    stage: computeStage(state, tasks),
    tasks: taskCounts(tasks),
    taskError: parsed.error
  };
}

export { approveGate, waiveGate };

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_TRANSITIONS, GATE_DEFS, ROLES, PROJECT_GATES, META_DIR } from './constants.mjs';
import { makeCheck, summarize, hasBlocking, exitCodeFor } from './checks.mjs';
import { getProfile, listProfiles } from './profiles.mjs';
import { checkAllArtifacts, readArtifact, ARTIFACTS } from './artifacts.mjs';
import { parseTasks, validateTasks, milestonesFromRoadmap, taskById, readyTasks, updateTaskStatus, appendTask, nextTaskId } from './tasks.mjs';
import {
  approveGate,
  waiveGate,
  computeStage,
  gateChecks,
  gateSummary,
  gateSatisfied,
  taskGateSatisfied,
  firstUnsatisfiedProjectGate,
  staleGates,
  gateDigest
} from './gates.mjs';
import { addEvidence, verifyTaskEvidence, requirePassingEvidence, listEvidence } from './evidence.mjs';
import { acquireLease, releaseLease, leaseStatus } from './lease.mjs';
import { defaultState, loadState, saveState, appendAudit } from './store.mjs';
import { RefusedError, UnavailableError, UsageError } from './errors.mjs';
import { nowIso, parseActor, parseScope, writeText, covers } from './util.mjs';

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

  const stale = await staleGates(root, state);
  for (const item of stale) {
    checks.push(
      makeCheck(
        'GATE_STALE',
        'fail',
        `${item.gate} was approved before ${item.changed.join(', ')} changed; re-approve it`,
        { stage: GATE_DEFS[item.gate]?.stage, gate: item.gate, changed: item.changed }
      )
    );
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
  for (const record of Object.values(state.questions ?? {})) {
    if (record.status !== 'open') continue;
    attention.push({
      kind: 'question',
      code: 'QUESTION_OPEN',
      message: `${record.id} for ${record.taskId}: ${record.question}`,
      task: record.taskId,
      question: record.id
    });
  }
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

function stopReason(result) {
  if (result.kind === 'gate') {
    const gate = result.gate;
    if (gate.id === 'G5') return `task review G5 for ${gate.task ?? 'a task'} needs a reviewer`;
    return `gate ${gate.id}${gate.title ? ` (${gate.title})` : ''} needs approval`;
  }
  if (result.kind === 'waiting') {
    const first = result.attention?.[0];
    return first ? `${first.code}: ${first.message}` : 'no actionable task; a decision is needed';
  }
  return null;
}

async function nextFrom(root, state, tasks, checks, role = null) {
  const result = await computeNext(root, state, tasks, checks, role);
  const needsUser = result.kind !== 'tasks';
  return { ...result, needsUser, reason: needsUser ? stopReason(result) : null };
}

async function computeNext(root, state, tasks, checks, role = null) {
  const stage = computeStage(state, tasks);
  const stale = await staleGates(root, state);
  if (stale.length > 0) {
    const item = stale[0];
    return {
      kind: 'gate',
      gate: { id: item.gate, title: GATE_DEFS[item.gate].title },
      checks: [],
      summary: { pass: 0, warn: 0, fail: 0, unavailable: 0, total: 0 },
      command: `trellis gate ${item.gate} --approve --by ${GATE_DEFS[item.gate].approvers[0]}:<name>`
    };
  }

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
  const stale = await staleGates(root, state);
  for (const item of stale) {
    if (gates[item.gate]) gates[item.gate].stale = true;
  }
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
    staleGates: stale,
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

const STALE_LEASE_HOURS = 24;
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

export async function projectReport(root) {
  const status = await projectStatus(root);
  const state = await loadState(root);
  const { tasks = [] } = await parseTasks(root);
  const gaps = [];

  for (const check of status.checks.blocking.filter((check) => check.code !== 'GATE_STALE')) {
    gaps.push({
      kind: 'check',
      severity: check.severity === 'fail' ? 'high' : 'medium',
      code: check.code,
      message: check.message,
      action: check.artifact ? `trellis check --stage ${status.stage}` : null
    });
  }

  const pendingGate = PROJECT_GATES.find((id) => status.gates[id]?.status !== 'passed' && status.gates[id]?.status !== 'waived');
  if (pendingGate) {
    const gate = GATE_DEFS[pendingGate];
    gaps.push({
      kind: 'gate',
      severity: 'high',
      code: 'GATE_PENDING',
      message: `${pendingGate} ${gate.title} is pending (approvers: ${gate.approvers.join(', ')})`,
      action: `trellis brief --role ${gate.approvers[0]}`
    });
  }

  for (const item of status.staleGates) {
    gaps.push({
      kind: 'gate',
      severity: 'high',
      code: 'GATE_STALE',
      message: `${item.gate} was approved before ${item.changed.join(', ')} changed`,
      action: `trellis gate ${item.gate} --approve --by ${GATE_DEFS[item.gate].approvers[0]}:<name>`
    });
  }

  for (const task of tasks.filter((item) => item.status === 'blocked')) {
    const note = state.taskNotes?.[task.id]?.note;
    gaps.push({
      kind: 'task',
      severity: 'medium',
      code: 'TASK_BLOCKED',
      message: `${task.id} is blocked${note ? `: ${note}` : ''}`,
      action: `trellis brief --role ${task.role}`
    });
  }

  for (const task of tasks.filter((item) => item.status === 'done')) {
    const checks = await verifyTaskEvidence(root, task.id);
    const failing = checks.filter((check) => check.severity === 'fail');
    if (failing.length > 0) {
      gaps.push({
        kind: 'evidence',
        severity: 'high',
        code: 'EVIDENCE_NOT_PASSING',
        message: `${task.id} is done but has no passing evidence (${failing.map((check) => check.code).join(', ')})`,
        action: `trellis evidence add --task ${task.id} --kind test --uri <file|url|commit> --verdict pass --by <role>:<name>`
      });
    }
  }

  const now = Date.now();
  for (const lease of status.leases) {
    const ageHours = Math.floor((now - Date.parse(lease.createdAt)) / 3_600_000);
    if (Number.isFinite(ageHours) && ageHours >= STALE_LEASE_HOURS) {
      gaps.push({
        kind: 'lease',
        severity: 'medium',
        code: 'LEASE_STALE',
        message: `${lease.taskId} lease is ${ageHours}h old (${lease.actor} on ${lease.domains.join(', ')})`,
        action: `trellis lease release ${lease.taskId} --by <role>:<name>`
      });
    }
  }

  gaps.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const passedGates = PROJECT_GATES.filter(
    (id) => status.gates[id]?.status === 'passed' || status.gates[id]?.status === 'waived'
  ).length;
  const doneTasks = tasks.filter((task) => task.status === 'done').length;
  const milestones = await milestonesFromRoadmap(root);
  const milestoneProgress = milestones.map((milestone) => {
    const items = tasks.filter((task) => task.milestone === milestone.id);
    const done = items.filter((task) => task.status === 'done').length;
    const active = items.some(
      (task) => ['in_progress', 'review'].includes(task.status) || task.status === 'done'
    );
    const status = items.length === 0 ? 'empty' : done === items.length ? 'done' : active ? 'in_progress' : 'todo';
    return {
      id: milestone.id,
      title: milestone.title,
      status,
      tasks: { done, total: items.length }
    };
  });
  const pendingQuestions = Object.values(state.questions ?? {})
    .filter((record) => record.status === 'open')
    .map((record) => ({
      id: record.id,
      taskId: record.taskId,
      question: record.question,
      askedBy: record.askedBy,
      askedAt: record.askedAt
    }));

  return {
    project: status.project,
    stage: status.stage,
    progress: {
      gates: { passed: passedGates, total: PROJECT_GATES.length },
      tasks: { done: doneTasks, total: tasks.length }
    },
    gaps: gaps.slice(0, 20),
    milestones: milestoneProgress,
    pendingQuestions,
    next: {
      kind: status.next.kind,
      command: status.next.command ?? null,
      needsUser: status.next.needsUser ?? null,
      reason: status.next.reason ?? null
    }
  };
}

const GATE_READS = {
  G0: ['PROJECT'],
  G1: ['PROJECT', 'RESEARCH'],
  G2: ['PROJECT', 'RESEARCH', 'ARCHITECTURE'],
  G3: ['ROADMAP', 'TASKS', 'VERIFICATION'],
  G4: ['TASKS'],
  G5: ['TASKS', 'VERIFICATION'],
  G6: ['TASKS', 'VERIFICATION'],
  G7: ['OPERATIONS', 'TASKS']
};

const ROLE_MUST_NOT = {
  human: ['approve a gate on behalf of an agent', 'let a role approve work it produced'],
  coordinator: ['write product code', 'approve G5'],
  architect: ['write product code', 'approve a gate for work you produced'],
  executor: ['approve a gate for work you produced', 'edit .trellis/docs/ARCHITECTURE.md'],
  reviewer: ['change the code under review', 'approve a gate for work you produced'],
  verifier: ['change the code under test', 'approve a gate for work you produced'],
  operator: ['write product code', 'approve a gate for work you produced']
};

export async function agentBrief(root, { role = null } = {}) {
  const state = await loadState(root);
  const parsed = await parseTasks(root);
  const tasks = parsed.tasks ?? [];
  const stage = computeStage(state, tasks);
  const gateId = firstUnsatisfiedProjectGate(state);
  const gate = gateId ? GATE_DEFS[gateId] : null;
  const chosenRole = role ?? gate?.approvers?.[0] ?? 'human';
  if (!ROLES.includes(chosenRole)) {
    throw new UsageError(`unknown role '${chosenRole}' (choose: ${ROLES.join(', ')})`);
  }

  const checksResult = await runChecks(root);
  const artifactPath = (id) => `${META_DIR}/${ARTIFACTS[id].path}`;
  const read = (gateId ? GATE_READS[gateId] ?? gate.artifacts : ['PROJECT', 'OPERATIONS']).map(artifactPath);
  const write = gate ? gate.artifacts.map(artifactPath) : [];
  if (gateId === 'G2') write.push(`${META_DIR}/docs/adr/*.md`);
  const blocking = checksResult.checks
    .filter((check) => check.severity === 'fail' || check.severity === 'unavailable')
    .map((check) => ({
      code: check.code,
      severity: check.severity,
      message: check.message,
      artifact: check.artifact ?? null
    }));
  const focus = stage === 'executing'
    ? tasks.find((task) => task.status === 'in_progress') ??
      tasks.find((task) => ['todo', 'ready'].includes(task.status)) ??
      null
    : null;

  const canApprove = gate ? gate.approvers.includes(chosenRole) : false;
  return {
    project: { name: state.project.name, profile: state.project.profile },
    stage,
    role: chosenRole,
    gate: gate
      ? {
          id: gate.id,
          title: gate.title,
          status: state.gates?.[gate.id]?.status ?? 'pending',
          approvers: gate.approvers
        }
      : null,
    read,
    write,
    mustNot: ROLE_MUST_NOT[chosenRole] ?? [],
    task: focus
      ? {
          id: focus.id,
          title: focus.title,
          status: focus.status,
          role: focus.role,
          scope: focus.scope,
          acceptance: focus.acceptance,
          verification: focus.verification
        }
      : null,
    checks: { summary: checksResult.summary, blocking },
    commands: {
      check: gate ? `trellis check --stage ${gate.stage}` : 'trellis check',
      approve: canApprove ? `trellis gate ${gate.id} --approve --by ${chosenRole}:<name>` : null,
      request:
        gate && !canApprove
          ? `ask ${gate.approvers.join(' or ')} to run: trellis gate ${gate.id} --approve --by ${gate.approvers[0]}:<name>`
          : null,
      blocked: focus ? `trellis task report ${focus.id} --state blocked --note "<one question>"` : null
    }
  };
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

export async function addTask(
  root,
  {
    title,
    role = 'executor',
    scope = '',
    milestone = null,
    acceptance = '',
    verification = '',
    dependsOn = [],
    id = null,
    followUpOf = null,
    by
  } = {}
) {
  if (!by) throw new UsageError('task add needs --by <role>:<name>');
  const actor = parseActor(by);
  for (const [field, value] of Object.entries({ title, acceptance, verification })) {
    const text = String(value ?? '').trim();
    if (text === '') throw new UsageError(`task add needs --${field}`);
    if (/[|\n\r]/.test(text)) throw new UsageError(`--${field} must not contain '|' or a newline`);
  }

  const state = await loadState(root);
  const { tasks } = await parseTasks(root);
  const milestones = await milestonesFromRoadmap(root);
  const taskId = id ? String(id).trim() : nextTaskId(tasks);
  if (!/^T-\d+$/.test(taskId)) throw new UsageError(`task id '${taskId}' does not look like T-001`);
  if (tasks.some((task) => task.id === taskId)) {
    throw new RefusedError('TASK_ID_DUPLICATE', `task ${taskId} is already on the board`, { task: taskId });
  }

  const domains = parseScope(scope);
  let dependencies = (Array.isArray(dependsOn) ? dependsOn : [dependsOn])
    .flatMap((value) => String(value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  let resolvedMilestone = milestone ?? milestones[0]?.id ?? null;
  let parent = null;
  let depth = 0;

  if (followUpOf) {
    parent = tasks.find((task) => task.id === followUpOf);
    if (!parent) {
      throw new RefusedError('TASK_UNKNOWN', `task ${followUpOf} is not on the board`, { task: followUpOf });
    }
    if (!['in_progress', 'review', 'done'].includes(parent.status)) {
      throw new RefusedError(
        'FOLLOWUP_PARENT_STATE',
        `follow-up parent ${parent.id} is '${parent.status}'; it must be in_progress, review or done`,
        { parent: parent.id, status: parent.status }
      );
    }
    depth = (state.followUps?.[parent.id]?.depth ?? 0) + 1;
    if (depth > 2) {
      throw new RefusedError('FOLLOWUP_DEPTH', `follow-up depth ${depth} exceeds 2`, { parent: parent.id, depth });
    }
    const siblings = Object.values(state.followUps ?? {}).filter((item) => item.parent === parent.id).length;
    if (siblings >= 3) {
      throw new RefusedError('FOLLOWUP_FANOUT', `${parent.id} already spawned ${siblings} follow-ups (max 3)`, {
        parent: parent.id,
        siblings
      });
    }
    resolvedMilestone = parent.milestone;
    dependencies = [...new Set([...dependencies, parent.id])];
    for (const domain of domains) {
      if (!parent.scope.some((prefix) => covers(prefix, domain))) {
        throw new RefusedError(
          'FOLLOWUP_SCOPE',
          `${domain} is not inside the scope of ${parent.id} (${parent.scope.join(', ')})`,
          { parent: parent.id, domain }
        );
      }
    }
  }

  const task = {
    id: taskId,
    milestone: resolvedMilestone,
    title: String(title).trim(),
    role,
    scope: domains,
    dependsOn: [...new Set(dependencies)],
    acceptance: String(acceptance).trim(),
    verification: String(verification).trim(),
    status: 'todo'
  };

  const checks = validateTasks([...tasks, task], { milestones });
  const blocking = checks.filter((check) => check.severity === 'fail');
  if (blocking.length > 0) {
    throw new RefusedError('TASK_INVALID', blocking.map((check) => check.message).join('; '), { checks: blocking });
  }

  await appendTask(root, task);
  if (parent) {
    state.followUps = state.followUps ?? {};
    state.followUps[task.id] = { parent: parent.id, depth, at: nowIso(), by: actor.raw };
    appendAudit(state, 'task.followUp', actor, { task: task.id, parent: parent.id, depth });
    for (const gateId of ['G3', 'G4']) {
      if (state.gates?.[gateId]?.status === 'passed') {
        state.gates[gateId].digest = await gateDigest(root, gateId);
        appendAudit(state, 'gate.digest.refreshed', actor, { gate: gateId, reason: `follow-up ${task.id}` });
      }
    }
  } else {
    appendAudit(state, 'task.added', actor, { task: task.id, title: task.title, milestone: task.milestone });
  }
  await saveState(root, state);
  return { task, followUpOf: parent?.id ?? null, depth };
}

export async function askTask(root, taskId, { question, by }) {
  if (!taskId) throw new UsageError('task ask needs a task id');
  if (!question || String(question).trim() === '') {
    throw new UsageError('task ask needs --question "<one question>"');
  }
  if (!by) throw new UsageError('task ask needs --by <role>:<name>');
  const actor = parseActor(by);
  const state = await loadState(root);
  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });

  state.questions = state.questions ?? {};
  const open = Object.values(state.questions).find((item) => item.taskId === taskId && item.status === 'open');
  if (open) {
    throw new RefusedError('QUESTION_OPEN', `task ${taskId} already has open question ${open.id}`, {
      task: taskId,
      question: open.id
    });
  }

  if (!['in_progress', 'review'].includes(task.status)) {
    throw new RefusedError(
      'QUESTION_NOT_ASKABLE',
      `task ${taskId} is '${task.status}'; only an in_progress or review task can ask`,
      { task: taskId, status: task.status }
    );
  }

  const id = `Q-${String(Object.keys(state.questions).length + 1).padStart(3, '0')}`;
  const record = {
    id,
    taskId,
    question: String(question).trim(),
    askedBy: actor.raw,
    askedAt: nowIso(),
    previousStatus: task.status,
    status: 'open',
    answer: null,
    answeredBy: null,
    answeredAt: null
  };
  state.questions[id] = record;
  await updateTaskStatus(root, taskId, 'blocked');
  state.taskNotes = state.taskNotes ?? {};
  state.taskNotes[taskId] = { note: record.question, at: record.askedAt, by: actor.raw, state: 'blocked' };
  appendAudit(state, 'task.question', actor, { task: taskId, question: id });
  await saveState(root, state);
  return { question: record, task: { ...task, status: 'blocked' } };
}

export async function answerTask(root, questionId, { decision, by }) {
  if (!questionId) throw new UsageError('task answer needs a question id');
  if (!decision || String(decision).trim() === '') {
    throw new UsageError('task answer needs --decision "<the answer>"');
  }
  if (!by) throw new UsageError('task answer needs --by <role>:<name>');
  const actor = parseActor(by);
  if (actor.role !== 'human') {
    throw new RefusedError('QUESTION_ANSWER_ROLE', `${actor.raw} cannot answer a question; only human can`, {
      actor: actor.raw
    });
  }

  const state = await loadState(root);
  const record = state.questions?.[questionId];
  if (!record) {
    throw new RefusedError('QUESTION_UNKNOWN', `no question '${questionId}'`, { question: questionId });
  }
  if (record.status !== 'open') {
    throw new RefusedError('QUESTION_ANSWERED', `question ${questionId} is already ${record.status}`, {
      question: questionId
    });
  }

  record.status = 'answered';
  record.answer = String(decision).trim();
  record.answeredBy = actor.raw;
  record.answeredAt = nowIso();
  await updateTaskStatus(root, record.taskId, record.previousStatus);
  appendAudit(state, 'task.answered', actor, { task: record.taskId, question: questionId });
  await saveState(root, state);
  return { question: record, task: { id: record.taskId, status: record.previousStatus } };
}

export async function reportTask(root, taskId, { state: newStatus, note = null, by }) {  if (!newStatus) throw new UsageError('task report needs --state <status>');
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

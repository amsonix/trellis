import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_TRANSITIONS, GATE_DEFS, ROLES, PROJECT_GATES, META_DIR, TASK_PRIORITIES } from './constants.mjs';
import { makeCheck, summarize, hasBlocking, exitCodeFor } from './checks.mjs';
import { getProfile, listProfiles } from './profiles.mjs';
import { checkAllArtifacts, readArtifact, ARTIFACTS } from './artifacts.mjs';
import { parseTasks, validateTasks, milestonesFromRoadmap, taskById, readyTasks, updateTaskStatus, updateTaskScope, updateTaskFields, appendTask, nextTaskId } from './tasks.mjs';
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
  driftedGates,
  gateDigest
} from './gates.mjs';
import { addEvidence, verifyTaskEvidence, requirePassingEvidence, listEvidence } from './evidence.mjs';
import { acquireLease, releaseLease, leaseStatus, leaseConflicts } from './lease.mjs';
import { defaultState, loadState, saveState, appendAudit } from './store.mjs';
import { RefusedError, UnavailableError, UsageError } from './errors.mjs';
import { nowIso, parseActor, parseScope, isSafeDomain, assertMaxLength, writeText, covers, overlaps } from './util.mjs';
import { currentAgent } from './identity.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'templates');
const SKILL_SOURCE = path.join(PACKAGE_ROOT, 'skills', 'trellis', 'SKILL.md');

export const TEMPLATE_MAP = {
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
    const doneIds = new Set(parsed.tasks.filter((task) => task.status === 'done').map((task) => task.id));
    for (const task of parsed.tasks) {
      if (task.status !== 'done') continue;
      const waitingOn = task.dependsOn.filter((dependency) => !doneIds.has(dependency));
      if (waitingOn.length > 0) {
        checks.push(
          makeCheck(
            'TASK_DONE_WITH_OPEN_DEPENDENCIES',
            'warn',
            `${task.id} is done but still waits on ${waitingOn.join(', ')}`,
            { task: task.id, waitingOn }
          )
        );
      }
    }
    const started = parsed.tasks.filter((task) => ['in_progress', 'review', 'done'].includes(task.status));
    if (started.length > 0 && !gateSatisfied(state, 'G4')) {
      checks.push(
        makeCheck(
          'TASK_BEFORE_PLAN',
          'warn',
          `${started.length} task(s) started before G4 Ready; approve the plan gates first`,
          { stage: 'executing', tasks: started.map((task) => task.id) }
        )
      );
    }
  }

  const drift = await driftedGates(root, state);
  for (const item of drift) {
    checks.push(
      makeCheck(
        'GATE_CONTENT_DRIFT',
        'warn',
        `${item.gate} content changed after approval (structure unchanged): ${item.changed.join(', ')}`,
        { stage: GATE_DEFS[item.gate]?.stage, gate: item.gate, changed: item.changed }
      )
    );
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
  const counts = { total: tasks.length, todo: 0, ready: 0, in_progress: 0, review: 0, blocked: 0, done: 0, canceled: 0 };
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

function staleGateResult(item, tasks, role) {
  return {
    kind: 'gate',
    gate: { id: item.gate, title: GATE_DEFS[item.gate].title, stale: true },
    checks: [],
    summary: { pass: 0, warn: 0, fail: 0, unavailable: 0, total: 0 },
    command: `trellis gate ${item.gate} --approve --by ${GATE_DEFS[item.gate].approvers[0]}:<name>`,
    candidate: candidateTask(tasks, role, item.gate),
    reason: `${item.gate} is approved but stale; re-approve it before integration`
  };
}

function candidateTask(tasks, role, gateId) {
  const next = readyTasks(tasks, role)[0];
  if (!next) return null;
  return {
    id: next.id,
    title: next.title,
    role: next.role,
    priority: next.priority,
    blockedBy: gateId
  };
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

async function nextFrom(root, state, tasks, checks, role = null, { limit = null, batch = null, strategy = 'priority' } = {}) {
  const result = await computeNext(root, state, tasks, checks, role);
  if (result.kind === 'tasks' && result.source === 'ready' && Number.isInteger(batch) && batch > 0) {
    result.tasks = selectTaskBatch(tasks, role, { batch, strategy });
    result.batch = result.tasks.length;
    result.batchRequested = batch;
    result.batchShortfall = Math.max(0, batch - result.tasks.length);
    result.strategy = strategy;
  }
  if (Number.isInteger(limit) && limit > 0 && Array.isArray(result.tasks)) {
    result.tasks = result.tasks.slice(0, limit);
  }
  const needsUser = result.kind !== 'tasks';
  if (needsUser && gateSatisfied(state, 'G4') && !gateSatisfied(state, 'G6')) {
    const ready = readyTasks(tasks, role);
    if (ready.length > 0) {
      result.alsoReady = ready.map(({ id, title, priority }) => ({ id, title, priority }));
    }
  }
  return { ...result, needsUser, reason: needsUser ? stopReason(result) : null };
}

async function computeNext(root, state, tasks, checks, role = null) {
  const invalid = tasks.filter((task) => task.statusValid === false);
  if (invalid.length > 0) {
    return {
      kind: 'waiting',
      attention: invalid.map((task) => ({
        kind: 'task',
        code: 'TASK_STATUS_INVALID',
        message: `task ${task.id} has unknown status '${task.status}'; fix the task board`
      }))
    };
  }
  const stage = computeStage(state, tasks);
  const stale = await staleGates(root, state);
  // A stale plan gate must be re-approved before review/integration, but it does
  // not stop execution that G4 already allows. Putting it first made `next`
  // return an approved-but-stale gate while ready tasks were claimable.
  const executingNow = gateSatisfied(state, 'G4') && !gateSatisfied(state, 'G6') && stage === 'executing';
  if (stale.length > 0 && !executingNow) {
    return staleGateResult(stale[0], tasks, role);
  }
  const staleAttention = stale.map((item) => ({
    kind: 'gate',
    code: 'GATE_STALE',
    message: `${item.gate} was approved but its plan changed; re-approve it before integration`,
    gate: item.gate
  }));

  // While G4 is satisfied and G6 is not, execution is the work. A reviewer can
  // ask for --role reviewer to see the per-task review gate instead.
  if (gateSatisfied(state, 'G4') && !gateSatisfied(state, 'G6') && stage === 'executing') {
    const ready = readyTasks(tasks, role);
    if (ready.length > 0) {
      return {
        kind: 'tasks',
        source: 'ready',
        tasks: ready.map(({ id, title, role: taskRole, scope, acceptance, priority }) => ({ id, title, role: taskRole, scope, acceptance, priority })),
        ...(staleAttention.length > 0 ? { attention: staleAttention } : {})
      };
    }
    const active = tasks.filter((task) => task.status === 'in_progress' && (!role || task.role === role));
    if (active.length > 0) {
      return {
        kind: 'tasks',
        tasks: active.map(({ id, title, role: taskRole, scope, acceptance }) => ({ id, title, role: taskRole, scope, acceptance })),
        note: 'in progress',
        ...(staleAttention.length > 0 ? { attention: staleAttention } : {})
      };
    }
    if (stale.length > 0) return staleGateResult(stale[0], tasks, role);
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
      command: `trellis gate ${gate} --approve --by <role>:<name>`,
      candidate: candidateTask(tasks, role, gate)
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
  const drift = await driftedGates(root, state);
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
    driftedGates: drift,
    taskGates: state.taskGates,
    tasks: taskCounts(tasks),
    checks: { summary: checksResult.summary, blocking: checksResult.checks.filter((check) => hasBlocking([check])) },
    attention,
    leases,
    next
  };
}

export async function nextAction(root, role = null, { limit = null, batch = null, strategy = 'priority' } = {}) {
  const state = await loadState(root);
  const parsed = await parseTasks(root);
  const tasks = parsed.tasks ?? [];
  const checksResult = await runChecks(root);
  return nextFrom(root, state, tasks, checksResult.checks, role, { limit, batch, strategy });
}

const STRATEGIES = ['priority', 'unblock', 'oldest'];

function unblockCounts(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'canceled') continue;
    for (const dependency of task.dependsOn) counts.set(dependency, (counts.get(dependency) ?? 0) + 1);
  }
  return counts;
}

function selectTaskBatch(tasks, role, { batch, strategy = 'priority' } = {}) {
  const mode = STRATEGIES.includes(strategy) ? strategy : 'priority';
  const unblocks = unblockCounts(tasks);
  const rank = (task) => ({ high: 0, medium: 1, low: 2 }[task.priority] ?? 1);
  const compare = (a, b) => {
    if (mode === 'unblock') {
      const byUnblock = (unblocks.get(b.id) ?? 0) - (unblocks.get(a.id) ?? 0);
      if (byUnblock !== 0) return byUnblock;
    }
    if (mode === 'oldest') {
      const byId = a.id.localeCompare(b.id, 'en', { numeric: true });
      if (byId !== 0) return byId;
    }
    const byPriority = rank(a) - rank(b);
    if (byPriority !== 0) return byPriority;
    const byMilestone = String(a.milestone).localeCompare(String(b.milestone), 'en', { numeric: true });
    if (byMilestone !== 0) return byMilestone;
    const byUnblock = (unblocks.get(b.id) ?? 0) - (unblocks.get(a.id) ?? 0);
    if (byUnblock !== 0) return byUnblock;
    return a.id.localeCompare(b.id, 'en', { numeric: true });
  };

  const selected = [];
  for (const task of [...readyTasks(tasks, role)].sort(compare)) {
    if (selected.length >= batch) break;
    if (task.scope.some((domain) => selected.some((picked) => picked.scope.some((other) => overlaps(domain, other))))) {
      continue;
    }
    const count = unblocks.get(task.id) ?? 0;
    const why = [
      `${task.priority} priority`,
      task.milestone ? `milestone ${task.milestone}` : null,
      count > 0 ? `unblocks ${count}` : null
    ].filter(Boolean).join(', ');
    selected.push({
      id: task.id,
      title: task.title,
      role: task.role,
      scope: task.scope,
      acceptance: task.acceptance,
      priority: task.priority,
      milestone: task.milestone,
      unblocks: count,
      why
    });
  }
  return selected;
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

export async function reapLeases(root, { by, olderThanHours = 24, reason = null } = {}) {
  if (!by) throw new UsageError('lease reap needs --by human:<name> or coordinator:<name>');
  const actor = parseActor(by);
  if (!['human', 'coordinator'].includes(actor.role)) {
    throw new RefusedError('LEASE_REAP_ROLE', 'only a human or coordinator may reap stale leases', { by: actor.raw });
  }
  if (actor.role === 'coordinator' && !reason) {
    throw new UsageError('a coordinator reap needs --reason "<why the holder is dead>"');
  }
  const hours = Number(olderThanHours);
  if (!Number.isFinite(hours) || hours <= 0) throw new UsageError('--older-than needs a positive number of hours');
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const state = await loadState(root);
  const stale = (await leaseStatus(root)).filter((lease) => Date.parse(lease.createdAt) < cutoff);
  const released = [];
  const skipped = [];
  for (const lease of stale) {
    if (actor.role === 'coordinator') {
      const holderRole = parseActor(lease.actor).role;
      const active = state.audit.filter(
        (event) =>
          event.detail?.task === lease.taskId &&
          event.action !== 'task.claimed' &&
          Date.parse(event.at) >= Date.parse(lease.createdAt)
      );
      if (holderRole !== 'executor' || active.length > 0) {
        skipped.push({
          taskId: lease.taskId,
          code: holderRole !== 'executor' ? 'LEASE_HOLDER_NOT_EXECUTOR' : 'LEASE_HAS_ACTIVITY',
          message:
            holderRole !== 'executor'
              ? `holder ${lease.actor} is not an executor`
              : `${active.length} audit event(s) since the claim`
        });
        continue;
      }
    }
    await releaseLease(root, lease.taskId, by);
    appendAudit(state, 'lease.reaped', actor, { task: lease.taskId, reason });
    released.push(lease.taskId);
  }
  await saveState(root, state);
  return { released, skipped, count: released.length, olderThanHours: hours, reason };
}

export async function claimTask(root, taskId, { by, paths, dryRun = false } = {}) {
  const actor = parseActor(by);
  const state = await loadState(root);
  if (process.env.TRELLIS_STRICT === '1' && !gateSatisfied(state, 'G4')) {
    throw new RefusedError('GATE_OUT_OF_ORDER', 'cannot claim a task before G4 Ready (TRELLIS_STRICT=1)', {
      gate: 'G4'
    });
  }
  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  if (task.statusValid === false) {
    throw new RefusedError('TASK_STATUS_INVALID', `task ${taskId} has unknown status '${task.status}'`, {
      task: taskId,
      status: task.status
    });
  }
  if (actor.role !== task.role && !['coordinator', 'human'].includes(actor.role)) {
    throw new RefusedError('TASK_ROLE', `${actor.raw} cannot claim ${taskId}; it is assigned to ${task.role}`, {
      task: taskId,
      role: task.role
    });
  }
  if (task.status === 'in_progress') {
    const held = (await leaseStatus(root)).find((item) => item.taskId === taskId);
    if (held) return { task, lease: held, idempotent: true };
    // No lease: the claim that put this row in `in_progress` is dead. The
    // transition table has no in_progress -> todo/ready, so without this branch
    // the task can be neither claimed nor released -- a dead end whose only exit
    // is a hand edit of the board. Take it over, but keep the fact.
    if (process.env.TRELLIS_NO_TAKEOVER === '1') {
      throw new RefusedError(
        'TASK_STALE_TAKEOVER_REFUSED',
        `${taskId} is in_progress with no lease; takeover is disabled by TRELLIS_NO_TAKEOVER=1`,
        { task: taskId }
      );
    }
  } else if (!['todo', 'ready'].includes(task.status)) {
    throw new RefusedError('TASK_NOT_CLAIMABLE', `task ${taskId} is '${task.status}', not todo/ready`, { task: taskId });
  }
  for (const domain of task.scope) {
    if (!isSafeDomain(domain)) {
      throw new RefusedError('TASK_SCOPE_INVALID', `task ${taskId} has an unsafe scope '${domain}' (globs and .. are not writable)`, {
        task: taskId,
        domain
      });
    }
  }
  const requested = paths ? parseScope(paths) : [];
  for (const path of requested) {
    if (!isSafeDomain(path)) {
      throw new UsageError(`--paths '${path}' is unsafe: use a relative path without '..', '*' or an absolute path`);
    }
    if (!task.scope.some((domain) => covers(domain, path))) {
      throw new RefusedError('LEASE_OUT_OF_SCOPE', `${path} is not inside ${taskId}'s scope`, {
        task: taskId,
        path,
        scope: task.scope
      });
    }
  }
  const leaseDomains = requested.length > 0 ? requested : task.scope;
  if (dryRun) {
    const conflicts = await leaseConflicts(root, { taskId, domains: leaseDomains });
    if (conflicts.length > 0) {
      throw new RefusedError(
        'LEASE_CONFLICT',
        `cannot lease ${leaseDomains.join(', ')} for ${taskId}: ${conflicts
          .map((conflict) => `${conflict.domain} is held by ${conflict.taskId} (${conflict.actor})`)
          .join('; ')}`,
        { conflicts }
      );
    }
    return { task, lease: { taskId, actor: actor.raw, domains: leaseDomains, dryRun: true }, dryRun: true };
  }
  const done = new Set(tasks.filter((item) => item.status === 'done').map((item) => item.id));
  const waitingOn = task.dependsOn.filter((dependency) => !done.has(dependency));
  if (waitingOn.length > 0) {
    throw new RefusedError('TASK_BLOCKED_BY_DEPENDENCY', `task ${taskId} waits on ${waitingOn.join(', ')}`, {
      task: taskId,
      waitingOn
    });
  }

  const lease = await acquireLease(root, { taskId, actor: actor.raw, domains: leaseDomains });
  const takenOver = task.status === 'in_progress';
  if (takenOver) {
    appendAudit(state, 'task.taken_over', actor, {
      task: taskId,
      lease: lease.id,
      reason: 'in_progress with no lease'
    });
  } else {
    await updateTaskStatus(root, taskId, 'in_progress');
    appendAudit(state, 'task.claimed', actor, { task: taskId, lease: lease.id });
  }
  await saveState(root, state);
  return { task: { ...task, status: 'in_progress' }, lease, takenOver };
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
    priority = 'medium',
    id = null,
    followUpOf = null,
    by
  } = {}
) {
  if (!by) throw new UsageError('task add needs --by <role>:<name>');
  const normalizedPriority = String(priority ?? 'medium').trim().toLowerCase();
  if (!TASK_PRIORITIES.includes(normalizedPriority)) {
    throw new UsageError(`--priority must be one of: ${TASK_PRIORITIES.join(', ')}`);
  }
  const actor = parseActor(by);
  for (const [field, value] of Object.entries({ title, acceptance, verification })) {
    const text = String(value ?? '').trim();
    if (text === '') throw new UsageError(`task add needs --${field}`);
    if (/[|\n\r]/.test(text)) throw new UsageError(`--${field} must not contain '|' or a newline`);
    assertMaxLength(text, field, field === 'title' ? 200 : 2000);
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
  if (domains.length === 0) throw new UsageError('task add needs --scope with at least one relative path');
  for (const domain of domains) {
    if (!isSafeDomain(domain)) {
      throw new UsageError(
        `--scope '${domain}' is unsafe: use a relative path without '..', '*' or an absolute path`
      );
    }
  }
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
    status: 'todo',
    priority: normalizedPriority
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

export async function editTask(root, taskId, { title, acceptance, verification, dependsOn, priority, scope, by } = {}) {
  if (!taskId) throw new UsageError('task edit needs a task id');
  if (!by) throw new UsageError('task edit needs --by <role>:<name>');
  const actor = parseActor(by);
  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });

  const fields = {};
  for (const [field, value] of Object.entries({ title, acceptance, verification })) {
    if (value === undefined) continue;
    const text = String(value).trim();
    if (text === '') throw new UsageError(`--${field} cannot be empty`);
    if (/[|\n\r]/.test(text)) throw new UsageError(`--${field} must not contain '|' or a newline`);
    assertMaxLength(text, field, field === 'title' ? 200 : 2000);
    fields[field] = text;
  }
  if (scope !== undefined) {
    const domains = parseScope(scope);
    if (domains.length === 0) throw new UsageError('--scope needs at least one relative path');
    for (const domain of domains) {
      if (!isSafeDomain(domain)) {
        throw new UsageError(`--scope '${domain}' is unsafe: use a relative path without '..', '*' or an absolute path`);
      }
    }
    fields.scope = domains.join(', ');
  }
  if (priority !== undefined) {
    const normalized = String(priority).trim().toLowerCase();
    if (!TASK_PRIORITIES.includes(normalized)) throw new UsageError(`--priority must be one of: ${TASK_PRIORITIES.join(', ')}`);
    fields.priority = normalized;
  }
  let dependencies = null;
  if (dependsOn !== undefined) {
    dependencies = (Array.isArray(dependsOn) ? dependsOn : [dependsOn])
      .flatMap((value) => String(value ?? '').split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    fields.dependsOn = dependencies.length > 0 ? dependencies.join(', ') : '-';
  }
  if (Object.keys(fields).length === 0) throw new UsageError('task edit needs at least one field');

  const updated = {
    ...task,
    ...(fields.scope ? { scope: parseScope(fields.scope) } : {}),
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.acceptance ? { acceptance: fields.acceptance } : {}),
    ...(fields.verification ? { verification: fields.verification } : {}),
    ...(fields.priority ? { priority: fields.priority } : {}),
    ...(dependencies ? { dependsOn: dependencies } : {})
  };
  const milestones = await milestonesFromRoadmap(root);
  const before = validateTasks(tasks, { milestones }).filter((check) => check.severity === 'fail');
  const after = validateTasks(tasks.map((item) => (item.id === taskId ? updated : item)), { milestones }).filter(
    (check) => check.severity === 'fail'
  );
  const signature = (check) =>
    `${check.code}|${(check.details?.tasks ?? []).join(',')}|${(check.details?.domains ?? []).join(',')}`;
  const known = new Set(before.map(signature));
  const introduced = after.filter((check) => !known.has(signature(check)));

  // A pre-existing violation must not make the only repair command unusable.
  // Clearing dependencies and narrowing the scope are always allowed, and any
  // other edit is allowed as long as it introduces no new blocking check.
  const narrowed =
    scope !== undefined &&
    parseScope(scope).every((domain) => task.scope.some((old) => covers(old, domain)));
  const clearedDependencies = dependencies !== null && dependencies.length === 0;
  if (introduced.length > 0 && !narrowed && !clearedDependencies) {
    throw new RefusedError('TASK_INVALID', introduced.map((check) => check.message).join('; '), {
      checks: introduced,
      preExisting: before.length
    });
  }

  const state = await loadState(root);
  await updateTaskFields(root, taskId, fields);
  appendAudit(state, 'task.edited', actor, { task: taskId, fields: Object.keys(fields) });
  await saveState(root, state);
  return { task: updated, changed: Object.keys(fields) };
}

export async function cancelTask(root, taskId, { by, reason }) {
  if (!taskId) throw new UsageError('task cancel needs a task id');
  if (!by) throw new UsageError('task cancel needs --by <role>:<name>');
  if (!reason || String(reason).trim() === '') throw new UsageError('task cancel needs --reason "<why>"');
  assertMaxLength(reason, 'reason', 1000);
  const actor = parseActor(by);
  if (!['human', 'coordinator'].includes(actor.role)) {
    throw new RefusedError('TASK_CANCEL_ROLE', `${actor.raw} cannot cancel a task; allowed: human, coordinator`, {
      actor: actor.raw
    });
  }

  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  if (task.status === 'canceled') {
    throw new RefusedError('TASK_CANCEL_STATE', `task ${taskId} is '${task.status}' and cannot be canceled`, {
      task: taskId,
      status: task.status
    });
  }

  const state = await loadState(root);
  await releaseLease(root, taskId, actor.raw);
  await updateTaskStatus(root, taskId, 'canceled');
  state.taskNotes = state.taskNotes ?? {};
  state.taskNotes[taskId] = { note: String(reason).trim(), at: nowIso(), by: actor.raw, state: 'canceled' };
  appendAudit(state, 'task.canceled', actor, { task: taskId, from: task.status, reason: String(reason).trim() });
  await saveState(root, state);
  return { task: { ...task, status: 'canceled' } };
}

export async function recoverTask(root, taskId, { to = 'ready', by, reason }) {
  if (!taskId) throw new UsageError('task recover needs a task id');
  if (!by) throw new UsageError('task recover needs --by <role>:<name>');
  if (!reason || String(reason).trim() === '') throw new UsageError('task recover needs --reason "<why>"');
  assertMaxLength(reason, 'reason', 1000);
  const actor = parseActor(by);
  if (!['human', 'coordinator'].includes(actor.role)) {
    throw new RefusedError('TASK_RECOVER_ROLE', `${actor.raw} cannot recover a task; allowed: human, coordinator`, {
      actor: actor.raw
    });
  }
  if (!['todo', 'ready'].includes(to)) throw new UsageError('--to must be todo or ready');

  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  if (task.status !== 'in_progress') {
    throw new RefusedError('TASK_RECOVER_STATE', `task ${taskId} is '${task.status}', not in_progress`, {
      task: taskId,
      status: task.status
    });
  }
  const held = (await leaseStatus(root)).find((item) => item.taskId === taskId);
  if (held) {
    throw new RefusedError('TASK_RECOVER_LEASE', `task ${taskId} still holds lease ${held.id}; release it first`, {
      task: taskId,
      lease: held.id
    });
  }

  const state = await loadState(root);
  await updateTaskStatus(root, taskId, to);
  appendAudit(state, 'task.recovered', actor, {
    task: taskId,
    from: 'in_progress',
    to,
    reason: String(reason).trim()
  });
  await saveState(root, state);
  return { task: { ...task, status: to } };
}

export async function applyTaskScope(root, taskId, scope, { by }) {
  if (!taskId) throw new UsageError('applyTaskScope needs a task id');
  if (!by) throw new UsageError('scope apply needs --by <role>:<name>');
  const actor = parseActor(by);
  const next = [...new Set((scope ?? []).map((item) => String(item).trim()).filter(Boolean))];
  if (next.length === 0) throw new UsageError('scope apply needs at least one path');

  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  for (const domain of next) {
    if (!task.scope.some((prefix) => covers(prefix, domain))) {
      throw new RefusedError('SCOPE_APPLY_WIDENS', `${domain} is outside the current scope of ${taskId}; only narrowing is allowed`, {
        task: taskId,
        domain,
        scope: task.scope
      });
    }
  }

  const state = await loadState(root);
  await updateTaskScope(root, taskId, next);
  appendAudit(state, 'task.scope.narrowed', actor, { task: taskId, from: task.scope, to: next });
  await saveState(root, state);
  return { task: { ...task, scope: next } };
}

export async function askTask(root, taskId, { question, by }) {
  if (!taskId) throw new UsageError('task ask needs a task id');
  if (!question || String(question).trim() === '') {
    throw new UsageError('task ask needs --question "<one question>"');
  }
  assertMaxLength(question, 'question', 1000);
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
    agent: currentAgent(),
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

export async function reportTask(root, taskId, { state: newStatus, note = null, by, dryRun = false } = {}) {
  if (!newStatus) throw new UsageError('task report needs --state <status>');
  const actor = by ? parseActor(by) : null;
  const state = await loadState(root);
  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  if (task.status === newStatus) {
    return { task, idempotent: true };
  }
  const heldLease = (await leaseStatus(root)).find((lease) => lease.taskId === taskId);
  if (heldLease && actor && heldLease.actor !== actor.raw && newStatus === 'blocked') {
    throw new RefusedError('TASK_LEASE_HELD_BY_OTHER', `task ${taskId} is leased by ${heldLease.actor}`, {
      task: taskId,
      lease: heldLease.id,
      actor: heldLease.actor
    });
  }
  const reopening = ['done', 'review'].includes(task.status) && ['in_progress', 'todo'].includes(newStatus);
  if (reopening) {
    if (!actor || !['human', 'coordinator'].includes(actor.role)) {
      throw new RefusedError('TASK_REOPEN_ROLE', `only a human or coordinator may reopen ${taskId}`, { task: taskId });
    }
    if (!note) throw new UsageError('reopening a task needs --note "<reason>"');
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

  if (['todo', 'ready'].includes(newStatus)) {
    const held = (await leaseStatus(root)).find((lease) => lease.taskId === taskId);
    if (held) {
      throw new RefusedError('TASK_LEASE_HELD', `task ${taskId} still holds a lease; release it before moving to todo`, {
        task: taskId,
        lease: held.id
      });
    }
  }
  let evidence = null;
  let warnings = [];
  if (newStatus === 'done') {
    const done = new Set(tasks.filter((item) => item.status === 'done' && item.id !== taskId).map((item) => item.id));
    const waitingOn = task.dependsOn.filter((dependency) => !done.has(dependency));
    if (waitingOn.length > 0) {
      warnings.push({
        code: 'TASK_DONE_WITH_OPEN_DEPENDENCIES',
        message: `${taskId} is done but still waits on ${waitingOn.join(', ')}`,
        waitingOn
      });
    }
    evidence = await requirePassingEvidence(root, taskId);
    if (!dryRun) {
      const released = await releaseLease(root, taskId, actor?.raw ?? null);
      if (released) {
        appendAudit(state, 'lease.released', actor, { task: taskId, reason: 'task.done', implicit: true });
      }
    }
  }
  if (reopening && !dryRun) {
    delete state.taskGates?.[taskId];
    appendAudit(state, 'task.reopened', actor, { task: taskId, from: task.status, note });
  }

  if (dryRun) {
    return { task: { ...task, status: newStatus }, evidence, warnings, dryRun: true };
  }
  await updateTaskStatus(root, taskId, newStatus);
  state.taskNotes = state.taskNotes ?? {};
  state.taskNotes[taskId] = { note, at: nowIso(), by: actor?.raw ?? null, state: newStatus };
  if (!reopening) appendAudit(state, `task.${newStatus}`, actor, { task: taskId, note });
  await saveState(root, state);
  return { task: { ...task, status: newStatus }, evidence, warnings };
}

export async function finishTask(root, taskId, { run, by, timeoutMs = 30 * 60 * 1000 } = {}) {
  if (!taskId) throw new UsageError('task finish needs a task id');
  if (!run) throw new UsageError('task finish needs --run "<command>"');
  if (!by) throw new UsageError('task finish needs --by <role>:<name>');
  const { tasks } = await parseTasks(root);
  const task = taskById(tasks, taskId);
  if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${taskId} is not on the task board`, { task: taskId });
  if (task.status !== 'in_progress') {
    throw new RefusedError('TASK_FINISH_STATE', `task ${taskId} is '${task.status}'; claim it before finishing`, {
      task: taskId,
      status: task.status
    });
  }

  const logDir = path.join(root, META_DIR, 'logs');
  const logName = `${taskId}-${nowIso().replace(/[:.]/g, '-')}.log`;
  const logFile = path.join(logDir, logName);
  await fs.mkdir(logDir, { recursive: true });

  let output = '';
  let exitCode = 0;
  let batch = null;
  let shell;
  let args;
  if (process.platform === 'win32') {
    // cmd.exe strips quotes around a quoted executable in /c; running a batch
    // file avoids that parsing entirely.
    batch = path.join(logDir, `.finish-${process.pid}-${Date.now()}.cmd`);
    await fs.writeFile(batch, `@echo off\r\n${run}\r\n`, 'utf8');
    shell = process.env.ComSpec || 'cmd.exe';
    args = ['/d', '/c', batch];
  } else {
    shell = '/bin/sh';
    args = ['-c', run];
  }
  await new Promise((resolve) => {
    const child = spawn(shell, args, { cwd: root });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { output += error.message; exitCode = 127; clearTimeout(timer); resolve(); });
    child.on('close', (code) => { clearTimeout(timer); exitCode = code ?? 1; resolve(); });
  });

  if (batch) await fs.rm(batch, { force: true }).catch(() => {});
  await writeText(logFile, output);
  const log = path.relative(root, logFile).split(path.sep).join('/');
  const evidence = await addEvidence(root, {
    taskId,
    kind: 'test',
    uri: log,
    verdict: exitCode === 0 ? 'pass' : 'fail',
    by,
    note: `exit ${exitCode}`
  });
  if (exitCode !== 0) {
    throw new RefusedError('TASK_FINISH_FAILED', `command exited ${exitCode}; log ${log}`, {
      taskId,
      exitCode,
      log,
      evidence: evidence.id
    });
  }
  const reported = await reportTask(root, taskId, { state: 'done', by });
  return { taskId, exitCode, log, evidence, task: reported.task };
}

export async function addTasks(root, items, { by } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new UsageError('task add --from needs a non-empty JSON array');
  }
  if (items.length > 200) throw new UsageError('task add --from accepts at most 200 tasks at a time');
  const added = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new UsageError('every imported task must be an object');
    }
    const result = await addTask(root, { ...item, by: item.by ?? by });
    added.push(result.task);
  }
  return { tasks: added, count: added.length };
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

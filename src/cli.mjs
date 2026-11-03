import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { PROTOCOL_VERSION } from './core/constants.mjs';
import { ProtocolError, RefusedError, UsageError, UnavailableError } from './core/errors.mjs';
import { summarize } from './core/checks.mjs';
import {
  initProject,
  projectStatus,
  runChecks,
  nextAction,
  agentBrief,
  projectReport,
  verifyTask,
  evidenceFor,
  listProfiles
} from './core/project.mjs';
import {
  addTask,
  askTask,
  answerTask,
  claimTask,
  reportTask,
  addTaskEvidence,
  reindex,
  approveGate,
  waiveGate,
  retractEvidence,
  releaseLease,
  compact
} from './core/mutations.mjs';
import { parseTasks } from './core/tasks.mjs';
import { leaseStatus, guardCommit } from './core/lease.mjs';
import { exportA2A } from './core/export-a2a.mjs';
import { suggestScopeForTask } from './core/scope.mjs';

const execFileAsync = promisify(execFile);

const VALUE_OPTIONS = new Set([
  'dir',
  'profile',
  'name',
  'stage',
  'role',
  'by',
  'note',
  'reason',
  'task',
  'kind',
  'uri',
  'verdict',
  'state',
  'title',
  'scope',
  'milestone',
  'acceptance',
  'verification',
  'depends-on',
  'follow-up-of',
  'priority',
  'paths',
  'proves',
  'archive-retracted',
  'question',
  'decision',
  'id'
]);

const FLAG_OPTIONS = new Set(['json', 'observe', 'approve', 'waive', 'staged', 'help', 'version', 'force', 'dry-run', 'a2a']);

function parseArgv(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      if (equals >= 0) {
        options[arg.slice(2, equals)] = arg.slice(equals + 1);
        continue;
      }
      const key = arg.slice(2);
      if (VALUE_OPTIONS.has(key)) {
        const value = argv[i + 1];
        if (value === undefined) throw new UsageError(`--${key} needs a value`);
        options[key] = value;
        i += 1;
      } else if (FLAG_OPTIONS.has(key)) {
        options[key] = true;
      } else {
        throw new UsageError(`unknown option --${key}`);
      }
    } else {
      positionals.push(arg);
    }
  }

  const command = positionals.shift() ?? null;
  let subcommand = null;
  if (['task', 'evidence', 'lease', 'guard', 'profile', 'scope'].includes(command)) {
    subcommand = positionals.shift() ?? null;
  }
  return { command, subcommand, positionals, options };
}

function dirOf(args, positionalIndex = 0) {
  return path.resolve(args.options.dir || args.positionals[positionalIndex] || process.cwd());
}

function usage() {
  return `trellis ${PROTOCOL_VERSION}

An agent-facing protocol for building projects: stages, artifacts, gates, roles,
tasks and evidence. Files are the source of truth; .trellis/ is the index.

Usage:
  trellis init [project-dir] [--profile <generic|web-app|library|cli>] [--name <name>]
      (works on an existing project; creates <project>/.trellis/ and, once,
       the agent skill .agents/skills/trellis/SKILL.md; never overwrites;
       profile defaults to generic, name defaults to the directory name)
  trellis status [dir] [--json]
  trellis check [dir] [--stage <stage>] [--json]
  trellis next [dir] [--role <role>] [--json]
  trellis brief [dir] [--role <role>] [--json]
  trellis report [dir] [--json]
  trellis gate <G0|G1|G2|G3|G4|G5|G6|G7> --approve|--waive --by <role>:<name>
                              [--task <T-NNN>] [--note <text>|--reason <text>] [--dir <dir>]
  trellis task list [dir] [--json]
  trellis task add --title <text> --scope <paths> --acceptance <text> --verification <text>
                   [--role <role>] [--milestone <M0>] [--depends-on <T-NNN>]
                   [--priority <high|medium|low>] [--follow-up-of <T-NNN>] [--id <T-NNN>]
                   --by <role>:<name> [--dir <dir>]
  trellis task claim <T-NNN> --by <role>:<name> [--dir <dir>]
  trellis task ask <T-NNN> --question <text> --by <role>:<name> [--dir <dir>]
  trellis task answer <Q-NNN> --decision <text> --by human:<name> [--dir <dir>]
  trellis task report <T-NNN> --state <status> [--note <text>] [--by <role>:<name>] [--dir <dir>]
  trellis evidence add --task <T-NNN> --kind <kind> --uri <file|url|commit>
                              --verdict <pass|fail|inconclusive> --by <role>:<name> [--dir <dir>]
  trellis evidence retract <EV-id> --by <role>:<name> --reason <text> [--dir <dir>]
  trellis evidence list [--task <T-NNN>] [--dir <dir>] [--json]
  trellis verify <T-NNN> [--dir <dir>] [--json]
  trellis lease status [--dir <dir>] [--json]
  trellis lease release <T-NNN> --by <role>:<name> [--dir <dir>]
  trellis guard commit --task <T-NNN> (--staged | --paths <a,b>) [--observe] [--dir <dir>]
  trellis reindex [dir] [--json]
  trellis compact [dir] [--dry-run] [--archive-retracted <days>] [--json]
  trellis export --a2a [dir] [--json]
  trellis scope suggest --task <T-NNN> [dir] [--json]
  trellis profile list [--json]
  trellis --version
  trellis --help

Exit codes:
  0 success / checks pass
  2 usage error
  3 refused / checks fail
  4 unavailable (missing state, unreadable artifact, git failure)
`;
}

function printInit(data) {
  console.log(`initialised ${data.name} (${data.profile}) in ${data.dir}`);
  console.log(`  management: ${data.managementDir}`);
  console.log(`  created ${data.created.length} files`);
  console.log('  next:');
  for (const line of data.next) console.log(`    ${line}`);
}

function gateSymbol(status) {
  if (status === 'passed') return 'PASS';
  if (status === 'waived') return 'WAIVED';
  return 'PENDING';
}

function printBrief(data) {
  console.log(`Role:    ${data.role}`);
  console.log(`Project: ${data.project.name} (${data.project.profile})`);
  console.log(`Stage:   ${data.stage}`);
  if (data.gate) console.log(`Gate:    ${data.gate.id} ${data.gate.title} (${data.gate.status})`);
  if (data.task) {
    console.log(`Task:    ${data.task.id} ${data.task.title} (${data.task.status})`);
    console.log(`  scope: ${data.task.scope.join(', ')}`);
  }
  console.log('');
  console.log('Read:');
  for (const item of data.read) console.log(`  ${item}`);
  if (data.write.length > 0) {
    console.log('');
    console.log('Write:');
    for (const item of data.write) console.log(`  ${item}`);
  }
  if (data.mustNot.length > 0) {
    console.log('');
    console.log('Do not:');
    for (const item of data.mustNot) console.log(`  - ${item}`);
  }
  const { pass, warn, fail, unavailable } = data.checks.summary;
  console.log('');
  console.log(`Checks: ${pass} pass, ${warn} warn, ${fail} fail, ${unavailable} unavailable`);
  for (const check of data.checks.blocking.slice(0, 5)) {
    console.log(`  ${check.severity.toUpperCase()} ${check.code}: ${check.message}`);
  }
  console.log('');
  console.log('Next:');
  console.log(`  ${data.commands.check}`);
  if (data.commands.approve) console.log(`  ${data.commands.approve}`);
  if (data.commands.request) console.log(`  ${data.commands.request}`);
  if (data.commands.blocked) console.log(`  ${data.commands.blocked}`);
}

function printReport(data) {
  console.log(`Trellis report — ${data.project.name} (${data.project.profile})`);
  console.log(`Stage:  ${data.stage}`);
  console.log(`Gates:  ${data.progress.gates.passed}/${data.progress.gates.total} passed`);
  console.log(`Tasks:  ${data.progress.tasks.done}/${data.progress.tasks.total} done`);
  if (data.milestones.length > 0) {
    console.log('');
    console.log('Milestones:');
    for (const milestone of data.milestones) {
      console.log(
        `  ${milestone.title.padEnd(28)} ${milestone.status.padEnd(12)} ${milestone.tasks.done}/${milestone.tasks.total} tasks`
      );
    }
  }
  console.log('');
  if (data.gaps.length === 0) {
    console.log('Gaps: none');
  } else {
    console.log(`Gaps (${data.gaps.length})`);
    for (const gap of data.gaps) {
      console.log(`  ${gap.severity.toUpperCase().padEnd(6)} ${gap.code}  ${gap.message}`);
      if (gap.action) console.log(`         → ${gap.action}`);
    }
  }
  if (data.next.command) {
    console.log('');
    console.log(`Next: ${data.next.command}`);
  }
}

function printCompact(data) {
  const { before, after } = data.evidence;
  const suffix = data.evidence.dryRun ? ' (dry run)' : '';
  console.log(`evidence: ${before.lines} events / ${before.bytes} B -> ${after.lines} records / ${after.bytes} B${suffix}`);
  if (data.evidence.archived > 0) {
    console.log(`archived: ${data.evidence.archived} retracted record(s) -> ${data.evidence.archive}${suffix}`);
  }
  if (data.audit) {
    console.log(`audit: rotated ${data.audit.from} (${data.audit.bytes} B) -> ${data.audit.to}${suffix}`);
  }
}

function printStatus(data) {
  console.log(`Project: ${data.project.name} (${data.project.profile})`);
  console.log(`Stage:   ${data.stage}`);
  console.log('Gates:');
  for (const gate of Object.values(data.gates)) {
    const who = gate.approvedBy ? ` ${gate.approvedBy}` : '';
    const stale = gate.stale ? ' [STALE]' : '';
    console.log(`  ${gate.id} ${gate.title.padEnd(14)} ${gateSymbol(gate.status)}${who}${stale}`);
  }
  console.log(`Tasks:   ${data.tasks.total} total | todo ${data.tasks.todo} | in_progress ${data.tasks.in_progress} | review ${data.tasks.review} | blocked ${data.tasks.blocked} | done ${data.tasks.done}`);
  if (data.attention.length > 0) {
    console.log('Attention:');
    for (const item of data.attention.slice(0, 12)) console.log(`  - [${item.code}] ${item.message}`);
    if (data.attention.length > 12) console.log(`  ... ${data.attention.length - 12} more`);
  }
  console.log('Next:');
  if (data.next.kind === 'gate') {
    console.log(`  approve ${data.next.gate.id} (${data.next.gate.title})`);
    console.log(`  ${data.next.command}`);
  } else if (data.next.kind === 'tasks') {
    for (const task of data.next.tasks) console.log(`  ${task.id} ${task.title} (${task.role})`);
  } else {
    console.log('  waiting: no gate or task is actionable');
  }
}

function printChecks(data) {
  const mark = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', unavailable: 'UNAVAIL' };
  for (const check of data.checks) {
    const where = check.artifact ? `${check.artifact}: ` : check.task ? `${check.task}: ` : '';
    console.log(`${mark[check.severity] ?? check.severity} ${where}${check.message}`);
  }
  const summary = data.summary;
  console.log(`summary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail, ${summary.unavailable} unavailable`);
}

function printNext(data) {
  if (data.kind === 'gate') {
    console.log(`next gate: ${data.gate.id} ${data.gate.title}`);
    console.log(data.command);
    if (data.checks.length > 0) printChecks({ checks: data.checks, summary: summarize(data.checks) });
  } else if (data.kind === 'tasks') {
    console.log('next tasks:');
    for (const task of data.tasks) console.log(`  ${task.id} ${task.title} (${task.role})`);
  } else {
    console.log('waiting: no gate or task is actionable');
    for (const item of data.attention ?? []) console.log(`  - [${item.code}] ${item.message}`);
  }
}

function printTaskList(tasks) {
  if (tasks.length === 0) {
    console.log('no tasks');
    return;
  }
  for (const task of tasks) {
    console.log(`${task.id}  ${task.status.padEnd(12)} ${task.role.padEnd(10)} ${task.title}`);
    console.log(`      scope: ${task.scope.join(', ')} | depends: ${task.dependsOn.join(', ') || '-'}`);
    console.log(`      acceptance: ${task.acceptance}`);
    console.log(`      verification: ${task.verification}`);
  }
}

function printEvidence(items) {
  if (items.length === 0) {
    console.log('no evidence');
    return;
  }
  for (const item of items) {
    const mark = item.retracted ? ' [retracted]' : '';
    console.log(`${item.id}  ${item.taskId}  ${item.kind.padEnd(10)} ${item.verdict.padEnd(12)} ${item.uri}${mark}`);
    if (item.sha256) console.log(`      sha256: ${item.sha256}`);
    if (item.note) console.log(`      note: ${item.note}`);
    if (item.retracted) console.log(`      retracted by ${item.retracted.by}: ${item.retracted.reason}`);
  }
}

async function gitStagedPaths(dir) {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: dir,
      maxBuffer: 16 * 1024 * 1024
    });
    return stdout.split('\0').filter(Boolean);
  } catch (error) {
    throw new UnavailableError(`cannot read staged paths with git: ${error.message}`, { dir });
  }
}

async function dispatch(args) {
  const { command, subcommand, options } = args;

  if (options.version || command === 'version') {
    return { data: { version: PROTOCOL_VERSION }, exitCode: 0, print: () => console.log(PROTOCOL_VERSION) };
  }
  if (options.help || !command) {
    return { data: { usage: usage() }, exitCode: 0, print: () => console.log(usage()) };
  }

  if (command === 'init') {
    const dir = path.resolve(args.positionals[0] || options.dir || process.cwd());
    const data = await initProject({ dir, name: options.name, profile: options.profile || 'generic' });
    return { data, exitCode: 0, print: () => printInit(data) };
  }

  if (command === 'status') {
    const data = await projectStatus(dirOf(args));
    return { data, exitCode: 0, print: () => printStatus(data) };
  }

  if (command === 'check') {
    const data = await runChecks(dirOf(args), options.stage || null);
    return { data, exitCode: data.exitCode, print: () => printChecks(data) };
  }

  if (command === 'next') {
    const data = await nextAction(dirOf(args), options.role || null);
    return { data, exitCode: 0, print: () => printNext(data) };
  }

  if (command === 'brief') {
    const data = await agentBrief(dirOf(args), { role: options.role || null });
    return { data, exitCode: 0, print: () => printBrief(data) };
  }

  if (command === 'report') {
    const data = await projectReport(dirOf(args));
    return { data, exitCode: 0, print: () => printReport(data) };
  }

  if (command === 'gate') {
    const gateId = args.positionals[0];
    if (!gateId) throw new UsageError('gate needs a gate id (G0..G7)');
    const dir = path.resolve(options.dir || args.positionals[1] || process.cwd());
    if (!options.approve && !options.waive) throw new UsageError('gate needs --approve or --waive');
    if (!options.by) throw new UsageError('gate needs --by <role>:<name>');
    let data;
    if (options.waive) {
      if (!options.reason) throw new UsageError('gate --waive needs --reason "<why>"');
      data = await waiveGate(dir, gateId, { by: options.by, reason: options.reason, taskId: options.task || null });
    } else {
      data = await approveGate(dir, gateId, { by: options.by, note: options.note || null, taskId: options.task || null });
    }
    return { data, exitCode: 0, print: () => console.log(`${data.gate}${data.taskId ? ` ${data.taskId}` : ''}: ${data.status} by ${data.approvedBy}`) };
  }

  if (command === 'task') {
    const dir = path.resolve(options.dir || (subcommand === 'list' ? args.positionals[0] : args.positionals[1]) || process.cwd());
    if (subcommand === 'add') {
      if (!options.title) throw new UsageError('task add needs --title');
      if (!options.scope) throw new UsageError('task add needs --scope');
      if (!options.acceptance) throw new UsageError('task add needs --acceptance');
      if (!options.verification) throw new UsageError('task add needs --verification');
      if (!options.by) throw new UsageError('task add needs --by <role>:<name>');
      const data = await addTask(dir, {
        title: options.title,
        role: options.role || 'executor',
        scope: options.scope,
        milestone: options.milestone || null,
        acceptance: options.acceptance,
        verification: options.verification,
        priority: options.priority || 'medium',
        dependsOn: options['depends-on'] || [],
        followUpOf: options['follow-up-of'] || null,
        id: options.id || null,
        by: options.by
      });
      return { data, exitCode: 0, print: () => console.log(`added ${data.task.id}: ${data.task.title}`) };
    }
    if (subcommand === 'list') {
      const { tasks, error } = await parseTasks(dir);
      if (error) throw new UnavailableError(error.message, error);
      return { data: { tasks }, exitCode: 0, print: () => printTaskList(tasks) };
    }
    if (subcommand === 'claim') {
      const taskId = args.positionals[0];
      if (!taskId) throw new UsageError('task claim needs a task id');
      if (!options.by) throw new UsageError('task claim needs --by <role>:<name>');
      const data = await claimTask(dir, taskId, { by: options.by });
      return { data, exitCode: 0, print: () => console.log(`claimed ${taskId}; lease ${data.lease.id} on ${data.lease.domains.join(', ')}`) };
    }
    if (subcommand === 'ask') {
      const taskId = args.positionals[0];
      if (!taskId) throw new UsageError('task ask needs a task id');
      if (!options.question) throw new UsageError('task ask needs --question "<one question>"');
      if (!options.by) throw new UsageError('task ask needs --by <role>:<name>');
      const data = await askTask(dir, taskId, { question: options.question, by: options.by });
      return { data, exitCode: 0, print: () => console.log(`asked ${data.question.id} for ${taskId}`) };
    }
    if (subcommand === 'answer') {
      const questionId = args.positionals[0];
      if (!questionId) throw new UsageError('task answer needs a question id');
      if (!options.decision) throw new UsageError('task answer needs --decision "<the answer>"');
      if (!options.by) throw new UsageError('task answer needs --by human:<name>');
      const data = await answerTask(dir, questionId, { decision: options.decision, by: options.by });
      return {
        data,
        exitCode: 0,
        print: () => console.log(`answered ${data.question.id}; ${data.task.id} is ${data.task.status}`)
      };
    }
    if (subcommand === 'report') {
      const taskId = args.positionals[0];
      if (!taskId) throw new UsageError('task report needs a task id');
      if (!options.state) throw new UsageError('task report needs --state <status>');
      const data = await reportTask(dir, taskId, { state: options.state, note: options.note || null, by: options.by || null });
      return { data, exitCode: 0, print: () => console.log(`${taskId}: ${data.task.status}`) };
    }
    throw new UsageError(`unknown task subcommand '${subcommand}' (list|claim|report)`);
  }

  if (command === 'evidence') {
    const dir = dirOf(args);
    if (subcommand === 'add') {
      if (!options.task) throw new UsageError('evidence add needs --task <T-NNN>');
      if (!options.kind) throw new UsageError('evidence add needs --kind <kind>');
      if (!options.uri) throw new UsageError('evidence add needs --uri <file|url|commit>');
      if (!options.verdict) throw new UsageError('evidence add needs --verdict <pass|fail|inconclusive>');
      if (!options.by) throw new UsageError('evidence add needs --by <role>:<name>');
      const record = await addTaskEvidence(dir, {
        taskId: options.task,
        kind: options.kind,
        uri: options.uri,
        verdict: options.verdict,
        by: options.by,
        note: options.note || null
      });
      return { data: record, exitCode: 0, print: () => console.log(`added ${record.id} for ${record.taskId} (${record.verdict})`) };
    }
    if (subcommand === 'list') {
      const items = await evidenceFor(dir, options.task || null);
      return { data: { items }, exitCode: 0, print: () => printEvidence(items) };
    }
    if (subcommand === 'retract') {
      const evidenceId = args.positionals[0];
      if (!evidenceId) throw new UsageError('evidence retract needs an evidence id');
      if (!options.by) throw new UsageError('evidence retract needs --by <role>:<name>');
      if (!options.reason) throw new UsageError('evidence retract needs --reason "<why>"');
      const record = await retractEvidence(dir, evidenceId, { by: options.by, reason: options.reason });
      return {
        data: record,
        exitCode: 0,
        print: () => console.log(`retracted ${record.id} (${record.verdict}) by ${record.retracted.by}`)
      };
    }
    throw new UsageError(`unknown evidence subcommand '${subcommand}' (add|list)`);
  }

  if (command === 'verify') {
    const taskId = args.positionals[0];
    if (!taskId) throw new UsageError('verify needs a task id');
    const data = await verifyTask(dirOf(args, 1), taskId);
    return { data, exitCode: data.exitCode, print: () => printChecks({ checks: data.checks, summary: data.summary }) };
  }

  if (command === 'lease') {
    const dir = dirOf(args);
    if (subcommand === 'status') {
      const items = await leaseStatus(dir);
      return {
        data: { items },
        exitCode: 0,
        print: () => {
          if (items.length === 0) console.log('no held leases');
          for (const lease of items) console.log(`${lease.taskId}  ${lease.actor}  ${lease.domains.join(', ')}`);
        }
      };
    }
    if (subcommand === 'release') {
      const taskId = args.positionals[0];
      if (!taskId) throw new UsageError('lease release needs a task id');
      if (!options.by) throw new UsageError('lease release needs --by <role>:<name>');
      const released = await releaseLease(dir, taskId, options.by);
      if (!released) throw new RefusedError('LEASE_NOT_HELD', `no held lease for ${taskId}`, { task: taskId });
      return { data: { taskId, released }, exitCode: 0, print: () => console.log(`released ${taskId}`) };
    }
    throw new UsageError(`unknown lease subcommand '${subcommand}' (status|release)`);
  }

  if (command === 'guard') {
    if (subcommand !== 'commit') throw new UsageError(`unknown guard subcommand '${subcommand}' (commit)`);
    const dir = dirOf(args);
    if (!options.task) throw new UsageError('guard commit needs --task <T-NNN>');
    if (!options.staged && !options.paths) {
      throw new UsageError('guard commit needs --staged (git diff --cached) or --paths <a,b>');
    }
    const stagedPaths = options.paths
      ? String(options.paths).split(',').map((value) => value.trim()).filter(Boolean)
      : await gitStagedPaths(dir);
    if (stagedPaths.length === 0) throw new UsageError('guard commit: no staged paths');
    const result = await guardCommit(dir, { taskId: options.task, stagedPaths, observe: Boolean(options.observe) });
    const exitCode = result.ok ? 0 : 3;
    return {
      data: result,
      exitCode,
      print: () => {
        if (result.violations.length === 0) {
          console.log(`guard commit: ${result.taskId} covers all ${result.stagedPaths.length} staged path(s)`);
          return;
        }
        const prefix = result.observed ? 'WOULD-BLOCK' : 'BLOCK';
        for (const violation of result.violations) console.log(`${prefix} [${violation.code}] ${violation.message}`);
        if (result.observed) console.log('observe mode: exit 0, no commit was blocked');
      }
    };
  }

  if (command === 'reindex') {
    const data = await reindex(dirOf(args));
    return { data, exitCode: 0, print: () => console.log(`reindexed ${data.project.name} (${data.project.profile}); stage ${data.stage}`) };
  }

  if (command === 'scope') {
    if (subcommand !== 'suggest') throw new UsageError('scope supports: suggest');
    if (!options.task) throw new UsageError('scope suggest needs --task <T-NNN>');
    const dir = dirOf(args);
    const { tasks, error } = await parseTasks(dir);
    if (error) throw new UnavailableError(error.message, error);
    const task = tasks.find((item) => item.id === options.task);
    if (!task) throw new RefusedError('TASK_UNKNOWN', `task ${options.task} is not on the task board`, { task: options.task });
    const { stdout } = await execFileAsync('git', ['log', '--all', '--name-only', '--format=', `--grep=${options.task}`], {
      cwd: dir,
      maxBuffer: 16 * 1024 * 1024
    });
    const files = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    const data = suggestScopeForTask(task.id, task.scope, files);
    return {
      data,
      exitCode: 0,
      print: () => {
        console.log(`current:   ${data.current.join(', ')}`);
        console.log(`suggested: ${data.suggested.length > 0 ? data.suggested.join(', ') : '(no touched file inside the scope)'}`);
        if (data.outside.length > 0) console.log(`outside:   ${data.outside.join(', ')}`);
      }
    };
  }

  if (command === 'export') {
    if (!options.a2a) throw new UsageError('export needs --a2a');
    const data = await exportA2A(dirOf(args));
    return { data, exitCode: 0, print: () => console.log(`exported ${data.tasks.length} task(s) as A2A`) };
  }

  if (command === 'compact') {
    const archiveRetractedDays = Number.parseInt(options['archive-retracted'] ?? '0', 10);
    if (!Number.isFinite(archiveRetractedDays) || archiveRetractedDays < 0) {
      throw new UsageError('--archive-retracted needs a positive number of days');
    }
    const data = await compact(dirOf(args), {
      dryRun: Boolean(options['dry-run']),
      archiveRetractedDays
    });
    return { data, exitCode: 0, print: () => printCompact(data) };
  }

  if (command === 'profile') {
    if (subcommand !== 'list') throw new UsageError(`unknown profile subcommand '${subcommand}' (list)`);
    const data = { profiles: listProfiles() };
    return {
      data,
      exitCode: 0,
      print: () => {
        for (const profile of data.profiles) console.log(`${profile.id.padEnd(10)} ${profile.title}: ${profile.description}`);
      }
    };
  }

  throw new UsageError(`unknown command '${command}'`);
}

export async function main(argv) {
  let args;
  try {
    args = parseArgv(argv);
  } catch (error) {
    const usageError = error instanceof ProtocolError ? error : new UsageError(error.message);
    if (argv.includes('--json')) {
      console.log(JSON.stringify({ ok: false, error: { code: usageError.code, message: usageError.message } }, null, 2));
    } else {
      console.error(`error ${usageError.code}: ${usageError.message}`);
    }
    return usageError.exitCode;
  }

  try {
    const result = await dispatch(args);
    if (args.options.json) {
      console.log(JSON.stringify({ ok: result.exitCode === 0, command: args.command, data: result.data }, null, 2));
    } else if (args.command && !args.options.help) {
      result.print();
    } else if (args.options.help || !args.command) {
      result.print();
    }
    return result.exitCode;
  } catch (error) {
    const protocolError = error instanceof ProtocolError
      ? error
      : new ProtocolError('INTERNAL', error.message, {}, 1);
    if (args.options.json) {
      console.log(JSON.stringify({
        ok: false,
        command: args.command,
        error: {
          code: protocolError.code,
          message: protocolError.message,
          details: protocolError.details ?? null
        }
      }, null, 2));
    } else {
      console.error(`error ${protocolError.code}: ${protocolError.message}`);
      if (protocolError.details?.checks) {
        printChecks({ checks: protocolError.details.checks, summary: summarize(protocolError.details.checks) });
      }
    }
    return protocolError.exitCode;
  }
}

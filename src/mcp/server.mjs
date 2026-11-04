#!/usr/bin/env node
/**
 * Minimal MCP server (stdio, newline-delimited JSON-RPC) for Trellis.
 *
 * Read tools are always on. Write tools are only registered when
 * TRELLIS_MCP_WRITE=1, and gate approval is never exposed: a gate approver must
 * not be the role that produced the work, so that decision stays in the CLI.
 */
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PROTOCOL_VERSION } from '../core/constants.mjs';
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
} from '../core/project.mjs';
import {
  addTask,
  askTask,
  answerTask,
  claimTask,
  reportTask,
  addTaskEvidence,
  reindex,
  retractEvidence,
  releaseLease,
  compact,
  recoverTask,
  cancelTask,
  finishTask
} from '../core/mutations.mjs';
import { parseTasks } from '../core/tasks.mjs';
import { leaseStatus } from '../core/lease.mjs';
import { exportA2A } from '../core/export-a2a.mjs';
import { ProtocolError, RefusedError } from '../core/errors.mjs';

const SERVER_INFO = { name: 'trellis', version: PROTOCOL_VERSION };
const PROTOCOL_FALLBACK = '2025-06-18';
const WRITE_ENABLED = process.env.TRELLIS_MCP_WRITE === '1';

const dirOf = (args) => path.resolve(args.dir || process.env.TRELLIS_DIR || process.cwd());
const object = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});
const text = (description) => ({ type: 'string', description });
const dirProp = text('Project directory. Defaults to TRELLIS_DIR, then the current directory.');

const readTools = [
  {
    name: 'trellis_status',
    description: 'Project stage, gates, task counts and blocking checks.',
    inputSchema: object({ dir: dirProp }),
    run: (args) => projectStatus(dirOf(args))
  },
  {
    name: 'trellis_check',
    description: 'Run the structural checks, optionally for one stage.',
    inputSchema: object({ dir: dirProp, stage: text('Stage to check, e.g. architecture.') }),
    run: (args) => runChecks(dirOf(args), args.stage ?? null)
  },
  {
    name: 'trellis_next',
    description: 'The one gate or task that is actionable now.',
    inputSchema: object({
      dir: dirProp,
      role: text('Role to answer as, e.g. architect.'),
      limit: { type: 'integer', minimum: 1, description: 'Return at most this many tasks.' }
    }),
    run: (args) => nextAction(dirOf(args), args.role ?? null, { limit: args.limit ?? null })
  },
  {
    name: 'trellis_brief',
    description: 'The current gate brief: read set, write set, prohibitions and next commands.',
    inputSchema: object({ dir: dirProp, role: text('Role to brief. Defaults to the first approver of the next gate.') }),
    run: (args) => agentBrief(dirOf(args), { role: args.role ?? null })
  },
  {
    name: 'trellis_report',
    description: 'Progress and gaps: gate/task counts, blocking checks, blocked tasks, unproven done tasks, stale leases and the next command.',
    inputSchema: object({ dir: dirProp }),
    run: (args) => projectReport(dirOf(args))
  },
  {
    name: 'trellis_task_list',
    description: 'The task board with scope, dependencies, acceptance and status.',
    inputSchema: object({ dir: dirProp }),
    run: async (args) => {
      const { tasks } = await parseTasks(dirOf(args));
      return { tasks };
    }
  },
  {
    name: 'trellis_evidence_list',
    description: 'Evidence records, optionally for one task.',
    inputSchema: object({ dir: dirProp, task: text('Task id, e.g. T-001.') }),
    run: (args) => evidenceFor(dirOf(args), args.task ?? null)
  },
  {
    name: 'trellis_verify',
    description: 'Verify the evidence for one task.',
    inputSchema: object({ dir: dirProp, task: text('Task id, e.g. T-001.') }, ['task']),
    run: (args) => verifyTask(dirOf(args), args.task)
  },
  {
    name: 'trellis_lease_status',
    description: 'Held write leases.',
    inputSchema: object({ dir: dirProp }),
    run: (args) => leaseStatus(dirOf(args))
  },
  {
    name: 'trellis_export_a2a',
    description: 'Read-only A2A view of the task board: Trellis statuses projected onto the A2A task lifecycle.',
    inputSchema: object({ dir: dirProp }),
    run: (args) => exportA2A(dirOf(args))
  },
  {
    name: 'trellis_profile_list',
    description: 'The available profiles and their required artifacts.',
    inputSchema: object(),
    run: () => ({ profiles: listProfiles() })
  }
];

const writeTools = [
  {
    name: 'trellis_init',
    description: 'Create .trellis/ and the agent skill in a project that does not have them. Never overwrites files.',
    inputSchema: object(
      {
        dir: text('Project directory to initialise.'),
        profile: text('generic (default), web-app, library or cli.'),
        name: text('Display name. Defaults to the directory name.')
      },
      ['dir']
    ),
    run: (args) => initProject({ dir: args.dir, name: args.name ?? null, profile: args.profile ?? 'generic' })
  },
  {
    name: 'trellis_task_add',
    description:
      'Add a task row to .trellis/docs/TASKS.md from a requirement or a bug report. Validates milestone, role, acceptance, verification and write scope before writing.',
    inputSchema: object(
      {
        dir: dirProp,
        title: text('What must be done.'),
        scope: text('Comma-separated write paths.'),
        acceptance: text('What makes it done.'),
        verification: text('How it is checked.'),
        role: text('Role that owns it. Defaults to executor.'),
        milestone: text('Milestone id from ROADMAP. Defaults to the first milestone.'),
        dependsOn: text('Comma-separated task ids.'),
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Scheduling priority; defaults to medium.' },
        followUpOf: text('Parent task id for execution-time work that must not re-open the plan gates.'),
        by: text('Actor as role:name.')
      },
      ['title', 'scope', 'acceptance', 'verification', 'by']
    ),
    run: (args) =>
      addTask(dirOf(args), {
        title: args.title,
        role: args.role ?? 'executor',
        scope: args.scope,
        milestone: args.milestone ?? null,
        acceptance: args.acceptance,
        verification: args.verification,
        priority: args.priority ?? 'medium',
        dependsOn: args.dependsOn ?? [],
        followUpOf: args.followUpOf ?? null,
        by: args.by
      })
  },
  {
    name: 'trellis_task_ask',
    description:
      'Ask one blocking question about a task. The task becomes blocked, the question is recorded on the ledger, and next/report surface it as needing a human answer.',
    inputSchema: object(
      {
        dir: dirProp,
        task: text('Task id.'),
        question: text('The one question that blocks the task.'),
        by: text('Actor as role:name.')
      },
      ['task', 'question', 'by']
    ),
    run: (args) => askTask(dirOf(args), args.task, { question: args.question, by: args.by })
  },
  {
    name: 'trellis_task_answer',
    description: 'Answer an open question as a human; the task returns to its previous status.',
    inputSchema: object(
      {
        dir: dirProp,
        question: text('Question id, e.g. Q-001.'),
        decision: text('The answer.'),
        by: text('Actor as human:<name>.')
      },
      ['question', 'decision', 'by']
    ),
    run: (args) => answerTask(dirOf(args), args.question, { decision: args.decision, by: args.by })
  },
  {
    name: 'trellis_task_claim',
    description: 'Claim a task and acquire the lease over its write scope.',
    inputSchema: object({ dir: dirProp, task: text('Task id.'), by: text('Actor as role:name.') }, ['task', 'by']),
    run: (args) => claimTask(dirOf(args), args.task, { by: args.by })
  },
  {
    name: 'trellis_task_report',
    description: 'Report a task state change. done requires passing evidence.',
    inputSchema: object(
      {
        dir: dirProp,
        task: text('Task id.'),
        state: text('todo, ready, in_progress, review, blocked or done.'),
        by: text('Actor as role:name.'),
        note: text('Short note or the one question when blocked.')
      },
      ['task', 'state']
    ),
    run: (args) =>
      reportTask(dirOf(args), args.task, { state: args.state, note: args.note ?? null, by: args.by ?? null })
  },
  {
    name: 'trellis_evidence_add',
    description: 'Record an evidence record for a task.',
    inputSchema: object(
      {
        dir: dirProp,
        task: text('Task id.'),
        kind: text('Evidence kind, e.g. test, build, review.'),
        uri: text('File path, URL or commit.'),
        verdict: text('pass, fail or inconclusive.'),
        by: text('Producer as role:name.'),
        note: text('Optional note.'),
        proves: text('Optional: which acceptance clause this evidence proves.')
      },
      ['task', 'kind', 'uri', 'verdict', 'by']
    ),
    run: (args) =>
      addTaskEvidence(dirOf(args), {
        taskId: args.task,
        kind: args.kind,
        uri: args.uri,
        verdict: args.verdict,
        by: args.by,
        note: args.note ?? null,
        proves: args.proves ?? null
      })
  },
  {
    name: 'trellis_evidence_retract',
    description:
      'Retract an evidence record with a reason. Retracted evidence stays in the ledger but no longer blocks done; only human, reviewer and verifier may retract.',
    inputSchema: object(
      {
        dir: dirProp,
        id: text('Evidence id, e.g. EV-abc123.'),
        by: text('Actor as role:name; must be human, reviewer or verifier.'),
        reason: text('Why the record is no longer valid.')
      },
      ['id', 'by', 'reason']
    ),
    run: (args) => retractEvidence(dirOf(args), args.id, { by: args.by, reason: args.reason })
  },
  {
    name: 'trellis_lease_release',
    description: 'Release a held lease when a task is abandoned or blocked.',
    inputSchema: object({ dir: dirProp, task: text('Task id.'), by: text('Actor as role:name.') }, ['task', 'by']),
    run: async (args) => {
      const released = await releaseLease(dirOf(args), args.task, args.by);
      if (!released) throw new RefusedError('LEASE_NOT_HELD', `no held lease for ${args.task}`, { task: args.task });
      return { taskId: args.task, released: true };
    }
  },
  {
    name: 'trellis_task_finish',
    description:
      'Run a verification command, record its output as evidence and mark the task done when it exits 0. A non-zero exit records failing evidence and refuses done.',
    inputSchema: object(
      {
        dir: dirProp,
        task: text('Task id.'),
        run: text('Command to run in the project root.'),
        by: text('Producer as role:name.')
      },
      ['task', 'run', 'by']
    ),
    run: (args) => finishTask(dirOf(args), args.task, { run: args.run, by: args.by })
  },
  {
    name: 'trellis_task_cancel',
    description:
      'Cancel work that is no longer needed. Terminal; only human or coordinator; releases the lease; canceled tasks do not satisfy dependencies.',
    inputSchema: object(
      {
        dir: dirProp,
        task: text('Task id.'),
        by: text('Actor as human:<name> or coordinator:<name>.'),
        reason: text('Why the task is canceled.')
      },
      ['task', 'by', 'reason']
    ),
    run: (args) => cancelTask(dirOf(args), args.task, { by: args.by, reason: args.reason })
  },
  {
    name: 'trellis_task_recover',
    description:
      'Return an in_progress task with no lease to ready or todo. Only human or coordinator; refuses while a lease is held; records task.recovered.',
    inputSchema: object(
      {
        dir: dirProp,
        task: text('Task id.'),
        by: text('Actor as human:<name> or coordinator:<name>.'),
        reason: text('Why the task is being recovered.'),
        to: { type: 'string', enum: ['ready', 'todo'], description: 'Target status; defaults to ready.' }
      },
      ['task', 'by', 'reason']
    ),
    run: (args) =>
      recoverTask(dirOf(args), args.task, {
        to: args.to ?? 'ready',
        by: args.by,
        reason: args.reason
      })
  },
  {
    name: 'trellis_reindex',
    description: 'Rebuild the state ledger from the artifacts.',
    inputSchema: object({ dir: dirProp }),
    run: (args) => reindex(dirOf(args))
  },
  {
    name: 'trellis_compact',
    description:
      'Fold the evidence event log into one record per id and rotate the audit stream when it exceeds 5 MB. Observable state is unchanged.',
    inputSchema: object({
      dir: dirProp,
      dryRun: { type: 'boolean', description: 'Report sizes without writing.' },
      archiveRetractedDays: { type: 'integer', minimum: 0, description: 'Archive retracted evidence older than this many days.' }
    }),
    run: (args) =>
      compact(dirOf(args), {
        dryRun: args.dryRun === true,
        archiveRetractedDays: args.archiveRetractedDays ?? 0
      })
  }
];

const tools = WRITE_ENABLED ? [...readTools, ...writeTools] : readTools;

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function fail(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function callTool(id, params) {
  const tool = tools.find((candidate) => candidate.name === params.name);
  if (!tool) {
    const disabled = writeTools.find((candidate) => candidate.name === params.name);
    if (disabled) {
      return fail(id, -32601, `tool '${params.name}' is disabled; start the server with TRELLIS_MCP_WRITE=1`);
    }
    return fail(id, -32602, `unknown tool '${params.name}'`);
  }
  try {
    const data = await tool.run(params.arguments ?? {});
    return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
  } catch (error) {
    const message =
      error instanceof ProtocolError ? `${error.code}: ${error.message}` : `INTERNAL: ${error.message}`;
    return ok(id, { content: [{ type: 'text', text: message }], isError: true });
  }
}

async function dispatch(message) {
  const { id, method, params } = message;
  if (id === undefined) return null; // notification
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      });
    case 'tools/call':
      return callTool(id, params ?? {});
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    let response;
    try {
      response = await dispatch(JSON.parse(line));
    } catch (error) {
      response = fail(null, -32700, `parse error: ${error.message}`);
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

export { main };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}

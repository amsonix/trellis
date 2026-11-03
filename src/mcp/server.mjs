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
  claimTask,
  reportTask,
  addTaskEvidence,
  verifyTask,
  evidenceFor,
  reindex,
  listProfiles
} from '../core/project.mjs';
import { parseTasks } from '../core/tasks.mjs';
import { leaseStatus, releaseLease } from '../core/lease.mjs';
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
    inputSchema: object({ dir: dirProp, role: text('Role to answer as, e.g. architect.') }),
    run: (args) => nextAction(dirOf(args), args.role ?? null)
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
        note: text('Optional note.')
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
        note: args.note ?? null
      })
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
    name: 'trellis_reindex',
    description: 'Rebuild the state ledger from the artifacts.',
    inputSchema: object({ dir: dirProp }),
    run: (args) => reindex(dirOf(args))
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

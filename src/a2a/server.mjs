/**
 * Minimal A2A HTTP endpoint over the task board.
 *
 * It exposes existing Trellis tasks; it deliberately does not implement
 * `message/send` because work is created through the plan gates, not by an
 * arbitrary A2A message. `tasks/cancel` maps to `task cancel` as
 * `coordinator:a2a` and can be disabled.
 */
import http from 'node:http';
import { PROTOCOL_VERSION } from '../core/constants.mjs';
import { loadState } from '../core/store.mjs';
import { parseTasks } from '../core/tasks.mjs';
import { exportA2A } from '../core/export-a2a.mjs';
import { cancelTask } from '../core/mutations.mjs';

export function agentCard({ url = 'http://127.0.0.1:8787', cancel = true } = {}) {
  return {
    name: 'trellis',
    description: 'Task board with gates, leases and evidence. Read tasks and cancel work.',
    version: PROTOCOL_VERSION,
    url,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    skills: [
      { id: 'tasks.get', name: 'Get task', description: 'Return one task with its status and artifacts.' },
      { id: 'tasks.list', name: 'List tasks', description: 'Return every task on the board.' },
      ...(cancel
        ? [{ id: 'tasks.cancel', name: 'Cancel task', description: 'Cancel work that is no longer needed.' }]
        : [])
    ]
  };
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('request body exceeds 1 MB');
    chunks.push(chunk);
  }
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function taskView(root, id) {
  const data = await exportA2A(root);
  return data.tasks.find((task) => task.id === id) ?? null;
}

export function createA2AServer({ root, cancel = true } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/.well-known/agent-card.json') {
        const host = req.headers.host ?? '127.0.0.1';
        return send(res, 200, agentCard({ url: `http://${host}`, cancel }));
      }
      if (req.method !== 'POST' || req.url !== '/') return send(res, 404, { error: 'not found' });

      let rpc;
      try {
        rpc = await readBody(req);
      } catch (error) {
        return send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } });
      }
      const { id = null, method, params = {} } = rpc;
      const reply = (result) => send(res, 200, { jsonrpc: '2.0', id, result });
      const fail = (code, message) => send(res, 200, { jsonrpc: '2.0', id, error: { code, message } });

      if (method === 'tasks/get') {
        if (!params.id) return fail(-32602, 'tasks/get needs params.id');
        const task = await taskView(root, params.id);
        if (!task) return fail(-32001, `task ${params.id} not found`);
        return reply(task);
      }
      if (method === 'tasks/list') {
        const data = await exportA2A(root);
        return reply({ tasks: data.tasks });
      }
      if (method === 'tasks/cancel') {
        if (!cancel) return fail(-32601, 'tasks/cancel is disabled (start with cancel enabled)');
        if (!params.id) return fail(-32602, 'tasks/cancel needs params.id');
        try {
          await cancelTask(root, params.id, {
            by: 'coordinator:a2a',
            reason: params.reason ?? 'canceled via A2A'
          });
        } catch (error) {
          return fail(-32002, error.message);
        }
        return reply(await taskView(root, params.id));
      }
      if (method === 'message/send') {
        return fail(-32601, 'message/send is not supported: create work through the Trellis plan gates');
      }
      return fail(-32601, `method not found: ${method}`);
    } catch (error) {
      return send(res, 500, { error: error.message });
    }
  });
}

export async function startA2A({ root, port = 8787, host = '127.0.0.1', cancel = true } = {}) {
  const state = await loadState(root);
  const { tasks } = await parseTasks(root);
  const server = createA2AServer({ root, cancel });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  return {
    server,
    url: `http://${host}:${address.port}`,
    project: state.project.name,
    tasks: tasks.length
  };
}

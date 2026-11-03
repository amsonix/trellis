import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from '../src/core/project.mjs';

const bin = fileURLToPath(new URL('../bin/trellis-mcp.mjs', import.meta.url));

function startClient(env = {}) {
  const child = spawn(process.execPath, [bin], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  });
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });
  let nextId = 1;
  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`));
      }, 5000).unref();
    });
  }
  return { request, stop: () => child.kill() };
}

async function withClient(env, run) {
  const client = startClient(env);
  try {
    await run(client);
  } finally {
    client.stop();
  }
}

const call = (client, name, args = {}) => client.request('tools/call', { name, arguments: args });
const payload = (response) => JSON.parse(response.result.content[0].text);

test('the MCP server exposes read tools and never a gate approval', async () => {
  await withClient({}, async (client) => {
    const init = await client.request('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.result.serverInfo.name, 'trellis');
    assert.equal(init.result.protocolVersion, '2025-06-18');

    const list = await client.request('tools/list');
    const names = list.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('trellis_status'));
    assert.ok(names.includes('trellis_brief'));
    assert.ok(!names.includes('trellis_task_claim'));
    assert.ok(names.every((name) => !name.includes('gate')));

    const disabled = await call(client, 'trellis_task_claim', { task: 'T-001', by: 'executor:w1' });
    assert.equal(disabled.error.code, -32601);
    assert.match(disabled.error.message, /TRELLIS_MCP_WRITE=1/);

    const unknown = await client.request('nope');
    assert.equal(unknown.error.code, -32601);
  });
});

test('read tools answer from the project directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-mcp-read-'));
  await initProject({ dir, name: 'demo', profile: 'generic' });
  try {
    await withClient({}, async (client) => {
      await client.request('initialize', { protocolVersion: '2025-06-18' });
      const status = await call(client, 'trellis_status', { dir });
      assert.equal(payload(status).stage, 'intake');

      const brief = await call(client, 'trellis_brief', { dir, role: 'architect' });
      assert.equal(payload(brief).gate.id, 'G0');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('write tools appear only with TRELLIS_MCP_WRITE=1 and claim tasks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-mcp-write-'));
  await initProject({ dir, name: 'demo', profile: 'generic' });
  try {
    await withClient({ TRELLIS_MCP_WRITE: '1' }, async (client) => {
      await client.request('initialize', { protocolVersion: '2025-06-18' });
      const list = await client.request('tools/list');
      const names = list.result.tools.map((tool) => tool.name);
      assert.ok(names.includes('trellis_task_claim'));
      assert.ok(names.every((name) => !name.includes('gate')));

      const claim = await call(client, 'trellis_task_claim', { dir, task: 'T-001', by: 'executor:w1' });
      assert.equal(claim.result.isError, undefined);

      const tasks = await call(client, 'trellis_task_list', { dir });
      assert.equal(payload(tasks).tasks[0].status, 'in_progress');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

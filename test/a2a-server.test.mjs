import test from 'node:test';
import assert from 'node:assert/strict';
import { startA2A } from '../src/a2a/server.mjs';
import { cleanup, makeProject } from './helpers.mjs';

async function rpc(url, method, params = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return response.json();
}

async function withServer(options, run) {
  const started = await startA2A(options);
  try {
    await run(started);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
  }
}

test('the A2A endpoint serves a card, tasks and cancel', async () => {
  const dir = await makeProject('generic');
  try {
    await withServer({ root: dir, port: 0 }, async ({ url }) => {
      const card = await (await fetch(`${url}/.well-known/agent-card.json`)).json();
      assert.equal(card.name, 'trellis');
      assert.ok(card.skills.some((skill) => skill.id === 'tasks.cancel'));

      const got = await rpc(url, 'tasks/get', { id: 'T-001' });
      assert.equal(got.result.id, 'T-001');
      assert.equal(got.result.metadata.trellis.status, 'todo');

      const listed = await rpc(url, 'tasks/list');
      assert.equal(listed.result.tasks.length, 1);

      const canceled = await rpc(url, 'tasks/cancel', { id: 'T-001', reason: 'not needed' });
      assert.equal(canceled.result.status.state, 'canceled');

      const unknown = await rpc(url, 'nope');
      assert.equal(unknown.error.code, -32601);
    });
  } finally {
    await cleanup(dir);
  }
});

test('tasks/cancel can be disabled', async () => {
  const dir = await makeProject('generic');
  try {
    await withServer({ root: dir, port: 0, cancel: false }, async ({ url }) => {
      const canceled = await rpc(url, 'tasks/cancel', { id: 'T-001', reason: 'x' });
      assert.equal(canceled.error.code, -32601);
    });
  } finally {
    await cleanup(dir);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rm } from 'node:fs/promises';
import { exportA2A } from '../src/core/export-a2a.mjs';
import { listProfiles } from '../src/core/profiles.mjs';
import { addEvidence } from '../src/core/evidence.mjs';
import { parseTasks, updateTaskStatus } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = path.resolve(fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url)));

async function run(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [bin, ...args]);
    return { code: 0, json: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.code, json: error.stdout ? JSON.parse(error.stdout) : null };
  }
}

test('every read command returns { ok, command, data }', async () => {
  const dir = await makeProject('generic');
  try {
    const commands = [
      ['status', '--dir', dir],
      ['check', '--dir', dir],
      ['next', '--role', 'architect', '--dir', dir],
      ['brief', '--role', 'architect', '--dir', dir],
      ['report', '--dir', dir],
      ['task', 'list', '--dir', dir],
      ['evidence', 'list', '--task', 'T-001', '--dir', dir],
      ['lease', 'status', '--dir', dir],
      ['export', '--a2a', '--dir', dir],
      ['compact', '--dry-run', '--dir', dir],
      ['reindex', '--dir', dir],
      ['profile', 'list']
    ];
    for (const args of commands) {
      const { json } = await run([...args, '--json']);
      assert.ok(json, `${args.join(' ')} produced no JSON`);
      assert.equal(typeof json.ok, 'boolean', args.join(' '));
      assert.ok(json.command, `${args.join(' ')} has no command`);
      assert.ok(json.data, `${args.join(' ')} has no data`);
    }
  } finally {
    await cleanup(dir);
  }
});

test('check failures are ok:false with checks in data, not an error field', async () => {
  const dir = await makeProject('generic');
  try {
    await rm(path.join(dir, '.trellis/docs/VERIFICATION.md'));
    const { code, json } = await run(['check', '--dir', dir, '--json']);
    assert.equal(code, 3);
    assert.equal(json.ok, false);
    assert.ok(Array.isArray(json.data.checks));
    assert.equal(json.error, undefined);
  } finally {
    await cleanup(dir);
  }
});

test('thrown failures carry an error object and a stable exit code', async () => {
  const dir = await makeProject('generic');
  try {
    const usage = await run(['unknown-command', '--json']);
    assert.equal(usage.code, 2);
    assert.equal(usage.json.error.code, 'USAGE');

    const missing = await run(['status', '--dir', path.join(dir, 'nope'), '--json']);
    assert.equal(missing.code, 4);
    assert.equal(missing.json.error.code, 'UNAVAILABLE');

    const refused = await run(['task', 'claim', 'T-001', '--by', 'reviewer:rita', '--dir', dir, '--json']);
    assert.equal(refused.code, 3);
    assert.equal(refused.json.error.code, 'TASK_ROLE');
  } finally {
    await cleanup(dir);
  }
});

test('every A2A task carries a known state and the Trellis metadata', async () => {
  const dir = await makeProject('generic');
  try {
    await updateTaskStatus(dir, 'T-001', 'in_progress');
    const data = await exportA2A(dir);
    assert.equal(data.kind, 'a2a.tasks');
    assert.equal(data.version, 1);
    assert.ok(data.contextId);
    const states = new Set(['submitted', 'working', 'input-required', 'completed']);
    const { tasks } = await parseTasks(dir);
    assert.equal(data.tasks.length, tasks.length);
    for (const task of data.tasks) {
      assert.ok(states.has(task.status.state), `${task.id}: ${task.status.state}`);
      assert.ok(task.metadata.trellis.status);
      assert.equal(task.metadata.trellis.status, tasks.find((item) => item.id === task.id).status);
    }
  } finally {
    await cleanup(dir);
  }
});

test('runtime records satisfy the checked-in schemas', async () => {
  const dir = await makeProject('generic');
  try {
    const readSchema = async (name) => JSON.parse(await readFile(new URL(`../schema/${name}`, import.meta.url), 'utf8'));

    const taskSchema = await readSchema('task.schema.json');
    const { tasks } = await parseTasks(dir);
    for (const key of taskSchema.required) assert.ok(key in tasks[0], `task missing ${key}`);
    assert.deepEqual(tasks[0].priority, 'medium');

    const evidenceSchema = await readSchema('evidence.schema.json');
    const record = await addEvidence(dir, {
      taskId: 'T-001', kind: 'test', uri: 'npm test', verdict: 'pass', by: 'executor:w1'
    });
    for (const key of evidenceSchema.required) assert.ok(key in record, `evidence missing ${key}`);
    assert.ok('proves' in record && 'agent' in record);

    const projectSchema = await readSchema('project.schema.json');
    const state = JSON.parse(await readFile(path.join(dir, '.trellis/state.json'), 'utf8'));
    for (const key of projectSchema.required) assert.ok(key in state, `state missing ${key}`);

    const profileSchema = await readSchema('profile.schema.json');
    for (const profile of listProfiles()) {
      for (const key of profileSchema.required) assert.ok(key in profile, `profile missing ${key}`);
    }
  } finally {
    await cleanup(dir);
  }
});

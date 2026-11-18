import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

async function run(dir, args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [bin, ...args], { cwd: dir });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('task add --dry-run is refused and writes nothing', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await run(dir, [
      'task', 'add', '--title', 'probe', '--scope', 'a.txt',
      '--acceptance', 'x', '--verification', 'y', '--by', 'coordinator:main',
      '--dry-run', '--json'
    ]);
    assert.equal(result.code, 2);
    assert.match(JSON.parse(result.stdout).error.message, /task add does not take --dry-run/);
    assert.equal((await parseTasks(dir)).tasks.length, 1);
  } finally {
    await cleanup(dir);
  }
});

test('task report --observe is refused and changes nothing', async () => {
  const dir = await makeProject('generic');
  try {
    const result = await run(dir, ['task', 'report', 'T-001', '--state', 'in_progress', '--observe', '--json']);
    assert.equal(result.code, 2);
    assert.match(JSON.parse(result.stdout).error.message, /task report does not take --observe/);
    assert.equal((await parseTasks(dir)).tasks[0].status, 'todo');
  } finally {
    await cleanup(dir);
  }
});

test('flags that belong to the command are still accepted', async () => {
  const dir = await makeProject('generic');
  try {
    const added = await run(dir, [
      'task', 'add', '--title', 'forced', '--scope', 'docs/c',
      '--acceptance', 'c', '--verification', 'manual', '--by', 'human:alice',
      '--force', '--json'
    ]);
    assert.equal(added.code, 0, added.stderr || added.stdout);

    const panel = await run(dir, ['status', '--panel']);
    assert.match(panel.stdout, /┌/);
  } finally {
    await cleanup(dir);
  }
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject, decideTask } from '../src/core/project.mjs';
import { addEvidence, claimTask, reportTask } from '../src/core/mutations.mjs';
import { listEvidence } from '../src/core/evidence.mjs';
import { parseTasks } from '../src/core/tasks.mjs';
import { META_DIR } from '../src/core/constants.mjs';

export async function makeProject(profile = 'web-app') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-test-'));
  await initProject({ dir, name: 'test-project', profile });
  return dir;
}

export async function cleanup(dir) {
  // Windows runners occasionally still hold a handle (indexer/AV) when a test
  // finishes; retry instead of turning a passing test into an EBUSY failure.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

export async function read(dir, rel) {
  return readFile(path.join(dir, rel), 'utf8');
}

export async function write(dir, rel, text) {
  await writeFile(path.join(dir, rel), text, 'utf8');
}

export async function replace(dir, rel, from, to) {
  const text = await read(dir, rel);
  if (from instanceof RegExp) {
    if (!from.test(text)) throw new Error(`fixture pattern not found in ${rel}: ${from}`);
    await write(dir, rel, text.replace(from, to));
    return;
  }
  if (!text.includes(from)) throw new Error(`fixture text not found in ${rel}: ${from}`);
  await write(dir, rel, text.replace(from, to));
}

export async function appendTask(dir, row) {
  const file = `${META_DIR}/docs/TASKS.md`;
  const text = await read(dir, file);
  await write(dir, file, `${text.trimEnd()}\n${row}\n`);
}

export function codes(checks) {
  return checks.map((check) => check.code);
}

export function failures(checks) {
  return checks.filter((check) => check.severity === 'fail' || check.severity === 'unavailable');
}

export async function completeTask(dir, taskId, { by = 'executor:w1', note = 'test completion' } = {}) {
  let { tasks } = await parseTasks(dir);
  let task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`completeTask: ${taskId} not found`);
  if (task.status === 'done') return task;
  if (['todo', 'ready'].includes(task.status)) {
    await claimTask(dir, taskId, { by });
    task = (await parseTasks(dir)).tasks.find((item) => item.id === taskId);
  }
  if (task.status === 'in_progress') {
    const records = (await listEvidence(dir, taskId)).filter((record) => !record.retracted);
    if (!records.some((record) => record.verdict === 'pass')) {
      await addEvidence(dir, {
        taskId, kind: 'test', uri: 'npm test', verdict: 'pass', by
      });
    }
    await reportTask(dir, taskId, { state: 'pending', reason: note, by });
  }
  return decideTask(dir, taskId, { decision: 'accept', note, by: 'human:test' });
}

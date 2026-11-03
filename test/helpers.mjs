import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/core/project.mjs';
import { META_DIR } from '../src/core/constants.mjs';

export async function makeProject(profile = 'web-app') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pp-test-'));
  await initProject({ dir, name: 'test-project', profile });
  return dir;
}

export async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkDoc, createAdr, listDocs, scaffoldDoc, showDoc } from '../src/core/docs.mjs';
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

test('doc list and show expose the artifacts', async () => {
  const dir = await makeProject('generic');
  try {
    const { items } = await listDocs(dir);
    assert.ok(items.some((item) => item.id === 'PROJECT' && item.exists));
    assert.ok(items.some((item) => item.id === 'TASKS' && item.exists));

    const project = await showDoc(dir, 'PROJECT');
    assert.equal(project.path, '.trellis/PROJECT.md');
    assert.match(project.text, /## Problem/);
    const checks = await checkDoc(dir, 'PROJECT');
    assert.ok(Array.isArray(checks));
    assert.ok(!checks.some((check) => check.severity === 'fail'));
  } finally {
    await cleanup(dir);
  }
});

test('doc scaffold restores a deleted document but never overwrites', async () => {
  const dir = await makeProject('generic');
  try {
    await rm(path.join(dir, '.trellis/docs/GLOSSARY.md'));
    const result = await scaffoldDoc(dir, 'GLOSSARY', { by: 'architect:ann' });
    assert.equal(result.path, '.trellis/docs/GLOSSARY.md');
    await assert.rejects(
      () => scaffoldDoc(dir, 'GLOSSARY', { by: 'architect:ann' }),
      (error) => error.code === 'ARTIFACT_EXISTS'
    );
    const audit = await readFile(path.join(dir, '.trellis/audit.jsonl'), 'utf8');
    assert.match(audit, /doc\.scaffolded/);
  } finally {
    await cleanup(dir);
  }
});

test('adr new allocates numbers, renders the decision and is audited', async () => {
  const dir = await makeProject('generic');
  try {
    const first = await createAdr(dir, { title: 'Use a single ledger', status: 'accepted', by: 'architect:ann' });
    const second = await createAdr(dir, { title: 'Second decision', by: 'human:alice' });
    assert.equal(first.number, '0002');
    assert.equal(second.number, '0003');
    const text = await readFile(path.join(dir, first.path), 'utf8');
    assert.match(text, /# ADR 0002: Use a single ledger/);
    assert.match(text, /## Status\n\nAccepted/);
    const audit = await readFile(path.join(dir, '.trellis/audit.jsonl'), 'utf8');
    assert.match(audit, /adr\.created/);
    const checks = await checkDoc(dir, 'ARCHITECTURE');
    assert.ok(!checks.some((check) => check.code === 'ADR_MISSING'));
  } finally {
    await cleanup(dir);
  }
});

test('the CLI exposes doc and adr commands', async () => {
  const dir = await makeProject('generic');
  try {
    const list = await run(dir, ['doc', 'list', '--json']);
    assert.equal(list.code, 0);
    assert.ok(JSON.parse(list.stdout).data.items.length >= 9);

    const adr = await run(dir, ['adr', 'new', '--title', 'CLI decision', '--by', 'architect:ann', '--json']);
    assert.equal(adr.code, 0, adr.stderr || adr.stdout);
    assert.equal(JSON.parse(adr.stdout).data.number, '0002');
  } finally {
    await cleanup(dir);
  }
});

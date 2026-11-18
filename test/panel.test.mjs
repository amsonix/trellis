import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { displayWidth, padDisplay, renderStatusPanel, stripMarkdown } from '../src/core/text.mjs';
import { cleanup, makeProject } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

test('display width counts CJK as two columns and ignores combining marks', () => {
  assert.equal(displayWidth('ab'), 2);
  assert.equal(displayWidth('中文'), 4);
  assert.equal(displayWidth('e\u0301'), 1);
  assert.equal(displayWidth('🙂'), 2);
  assert.equal(displayWidth(padDisplay('中', 4)), 4);
});

test('markdown decoration is stripped before rendering', () => {
  assert.equal(stripMarkdown('**Bold** and `code`'), 'Bold and code');
});

test('the panel keeps every line the same display width', () => {
  const data = {
    project: { name: '中文项目', profile: 'generic' },
    stage: 'executing',
    gates: { G0: { id: 'G0', title: 'Scope', status: 'passed' }, G1: { id: 'G1', title: 'Research', status: 'pending' } },
    tasks: { total: 2, done: 1, canceled: 0, in_progress: 1, todo: 0, ready: 0, blocked: 0, review: 0 },
    checks: { summary: { pass: 1, warn: 0, fail: 0, unavailable: 0 } },
    leases: [{ taskId: 'T-002', actor: 'executor:x', createdAt: new Date().toISOString() }],
    attention: [{ code: 'X', message: '**bold** `code` 中文' }],
    next: { kind: 'tasks', tasks: [{ id: 'T-002', title: '**Implement** `thing`', role: 'executor' }] }
  };
  const panel = renderStatusPanel(data);
  const lines = panel.split('\n');
  const widths = new Set(lines.map((line) => displayWidth(line)));
  assert.equal(widths.size, 1, `ragged panel: ${[...widths].join(',')}`);
  assert.ok(!panel.includes('**'));
  assert.ok(!panel.includes('`'));
});

test('status --panel renders and --json wins over it', async () => {
  const dir = await makeProject('generic');
  try {
    const panel = await execFileAsync(process.execPath, [bin, 'status', '--panel'], { cwd: dir });
    assert.match(panel.stdout, /┌/);
    assert.match(panel.stdout, /stage:/);

    const json = await execFileAsync(process.execPath, [bin, 'status', '--panel', '--json'], { cwd: dir });
    const data = JSON.parse(json.stdout);
    assert.equal(data.ok, true);
    assert.ok(!json.stdout.includes('┌'));

    const help = await execFileAsync(process.execPath, [bin, 'help', 'status'], { cwd: dir });
    assert.match(help.stdout, /--panel/);
    assert.match(help.stdout, /Options:/);
  } finally {
    await cleanup(dir);
  }
});

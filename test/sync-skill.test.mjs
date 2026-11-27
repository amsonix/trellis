import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { syncSkill } from '../src/core/project.mjs';
import { saveTaskReport, listTaskReports } from '../src/core/reports.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('report-save reads a file, records its sha256 and keeps a relative path', async () => {
  const dir = await makeProject('generic');
  try {
    const source = path.join(dir, 'legacy-report.md');
    await writeFile(source, '旧版本写下的任务报告\n第二行');
    const report = await saveTaskReport(dir, {
      taskId: 'T-001', sourcePath: 'legacy-report.md', actor: 'coordinator:kim'
    });
    assert.equal(report.sourceFile, 'legacy-report.md');
    assert.match(report.sha256, /^[0-9a-f]{64}$/);
    const listed = await listTaskReports(dir, { taskId: 'T-001' });
    assert.equal(listed[0].sha256, report.sha256);
  } finally {
    await cleanup(dir);
  }
});

test('report-save refuses a missing file', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => saveTaskReport(dir, { taskId: 'T-001', sourcePath: 'nope.md', actor: 'coordinator:kim' }),
      (error) => error.code === 'REPORT_FILE_MISSING'
    );
  } finally {
    await cleanup(dir);
  }
});

test('skill sync is idempotent, refuses divergence and overwrites with force', async () => {
  const dir = await makeProject('generic');
  try {
    const target = path.join(dir, '.agents/skills/trellis/SKILL.md');
    const first = await syncSkill(dir);
    assert.equal(first.created, false);
    assert.equal(first.changed, false);
    assert.equal((await syncSkill(dir)).changed, false);

    const original = await readFile(target, 'utf8');
    await writeFile(target, `${original}\n# local edit\n`);
    await assert.rejects(() => syncSkill(dir), (error) => error.code === 'SKILL_EXISTS');
    const forced = await syncSkill(dir, { force: true });
    assert.equal(forced.changed, true);
    assert.equal(await readFile(target, 'utf8'), original);
  } finally {
    await cleanup(dir);
  }
});

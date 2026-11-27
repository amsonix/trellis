import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { saveTaskReport, listTaskReports, readTaskReport } from '../src/core/reports.mjs';
import { taskShow } from '../src/core/project.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('a report is archived under .trellis and linked to its task', async () => {
  const dir = await makeProject('generic');
  try {
    const report = await saveTaskReport(dir, {
      taskId: 'T-001',
      text: 'Implemented the parser. Found that error paths need a separate task.',
      title: 'Parser slice',
      actor: 'executor:lane-a'
    });
    assert.equal(report.id, 'RP-001');
    assert.equal(report.taskId, 'T-001');
    assert.match(report.path, /^\.trellis\/reports\/T-001\//);

    const body = await readFile(path.join(dir, report.path), 'utf8');
    assert.match(body, /task: T-001/);
    assert.match(body, /Implemented the parser/);

    const stored = await readTaskReport(dir, 'RP-001');
    assert.equal(stored.text, 'Implemented the parser. Found that error paths need a separate task.');

    const listed = await listTaskReports(dir, { taskId: 'T-001' });
    assert.deepEqual(listed.map((item) => item.id), ['RP-001']);
    assert.equal((await listTaskReports(dir, { taskId: 'T-002' })).length, 0);

    const shown = await taskShow(dir, 'T-001');
    assert.equal(shown.reports.count, 1);
    assert.equal(shown.reports.latest.id, 'RP-001');
  } finally {
    await cleanup(dir);
  }
});

test('superseding a report hides the old one unless requested', async () => {
  const dir = await makeProject('generic');
  try {
    const first = await saveTaskReport(dir, {
      taskId: 'T-001', text: 'first attempt', actor: 'executor:lane-a'
    });
    const second = await saveTaskReport(dir, {
      taskId: 'T-001', text: 'revised report', actor: 'executor:lane-a', supersedes: first.id
    });
    assert.equal(second.supersedes, 'RP-001');

    assert.deepEqual((await listTaskReports(dir, { taskId: 'T-001' })).map((r) => r.id), ['RP-002']);
    assert.deepEqual(
      (await listTaskReports(dir, { taskId: 'T-001', includeSuperseded: true })).map((r) => r.id),
      ['RP-001', 'RP-002']
    );
    const old = (await listTaskReports(dir, { taskId: 'T-001', includeSuperseded: true }))[0];
    assert.equal(old.supersededBy, 'RP-002');
  } finally {
    await cleanup(dir);
  }
});

test('a report must have a valid task id, text and actor', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => saveTaskReport(dir, { taskId: 'nope', text: 'x', actor: 'executor:a' }),
      (error) => error.code === 'USAGE'
    );
    await assert.rejects(
      () => saveTaskReport(dir, { taskId: 'T-001', text: '', actor: 'executor:a' }),
      (error) => error.code === 'USAGE'
    );
    await assert.rejects(
      () => saveTaskReport(dir, { taskId: 'T-001', text: 'x' }),
      (error) => error.code === 'USAGE'
    );
    await assert.rejects(
      () => readTaskReport(dir, 'RP-999'),
      (error) => error.code === 'REPORT_UNKNOWN'
    );
  } finally {
    await cleanup(dir);
  }
});

test('superseding a report from another task is refused', async () => {
  const dir = await makeProject('generic');
  try {
    const report = await saveTaskReport(dir, { taskId: 'T-001', text: 'x', actor: 'executor:a' });
    await assert.rejects(
      () => saveTaskReport(dir, {
        taskId: 'T-002', text: 'y', actor: 'executor:a', supersedes: report.id
      }),
      (error) => error.code === 'REPORT_TASK_MISMATCH'
    );
  } finally {
    await cleanup(dir);
  }
});

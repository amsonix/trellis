import fs from 'node:fs/promises';
import path from 'node:path';
import { META_DIR } from './constants.mjs';
import { RefusedError, UsageError, ProtocolError } from './errors.mjs';
import { exists, nowIso, parseActor, syncFile, syncDirectory } from './util.mjs';

export const REPORTS_DIR = `${META_DIR}/reports`;
export const REPORT_INDEX = `${META_DIR}/reports/index.jsonl`;

function reportsDir(root) {
  return path.join(root, REPORTS_DIR);
}

function indexFile(root) {
  return path.join(root, REPORT_INDEX);
}

function taskDir(root, taskId) {
  return path.join(reportsDir(root), taskId);
}

async function appendIndex(root, event) {
  const file = indexFile(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'a');
  try {
    await handle.appendFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

async function loadIndex(root) {
  const file = indexFile(root);
  if (!(await exists(file))) return [];
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const torn = !text.endsWith('\n');
  const reports = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      if (torn && i === lines.length - 1) continue;
      throw new ProtocolError('REPORT_INDEX_CORRUPT', `report index corrupt at line ${i + 1}`, { file, line: i + 1 }, 4);
    }
    if (event.type === 'add') reports.push({ ...event.report });
    else if (event.type === 'supersede') {
      const target = reports.find((item) => item.id === event.id);
      if (target) {
        target.supersededBy = event.supersededBy;
        target.supersededAt = event.at;
      }
    }
  }
  return reports;
}

function nextId(reports) {
  const used = new Set(reports.map((item) => item.id));
  let n = 1;
  while (used.has(`RP-${String(n).padStart(3, '0')}`)) n += 1;
  return `RP-${String(n).padStart(3, '0')}`;
}

export async function saveTaskReport(root, { taskId, text, actor, title = null, supersedes = null }) {
  if (!taskId || !/^T-\d+$/.test(taskId)) throw new UsageError('task report needs a task id like T-001');
  if (!text || String(text).trim() === '') throw new UsageError('task report needs --text');
  if (!actor) throw new UsageError('task report needs --by <role>:<name>');
  const by = parseActor(actor);
  const reports = await loadIndex(root);
  if (supersedes) {
    const prior = reports.find((item) => item.id === supersedes);
    if (!prior) throw new RefusedError('REPORT_UNKNOWN', `no report '${supersedes}'`, { report: supersedes });
    if (prior.taskId !== taskId) {
      throw new RefusedError('REPORT_TASK_MISMATCH', `report ${supersedes} belongs to ${prior.taskId}`, {
        report: supersedes, task: prior.taskId
      });
    }
  }
  const id = nextId(reports);
  const at = nowIso();
  const stamp = at.replace(/[:.]/g, '-');
  const file = path.join(taskDir(root, taskId), `${stamp}-${id}.md`);
  const body = [
    `# ${title ?? `Task report ${id}`}`,
    '',
    `- id: ${id}`,
    `- task: ${taskId}`,
    `- by: ${by.raw}`,
    `- at: ${at}`,
    ...(supersedes ? [`- supersedes: ${supersedes}`] : []),
    '',
    '## Report',
    '',
    String(text).trim(),
    ''
  ].join('\n');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, 'utf8');
  await syncFile(file);
  await syncDirectory(path.dirname(file));
  const report = {
    id,
    taskId,
    by: by.raw,
    at,
    title: title ? String(title).trim() : null,
    path: path.relative(root, file).split(path.sep).join('/'),
    supersedes: supersedes ?? null,
    supersededBy: null,
    supersededAt: null
  };
  await appendIndex(root, { type: 'add', report, at });
  if (supersedes) {
    await appendIndex(root, { type: 'supersede', id: supersedes, supersededBy: id, at });
  }
  return report;
}

export async function listTaskReports(root, { taskId = null, includeSuperseded = false } = {}) {
  return (await loadIndex(root))
    .filter((item) => (taskId ? item.taskId === taskId : true))
    .filter((item) => (includeSuperseded ? true : !item.supersededBy));
}

export async function readTaskReport(root, id) {
  const report = (await loadIndex(root)).find((item) => item.id === id);
  if (!report) throw new RefusedError('REPORT_UNKNOWN', `no report '${id}'`, { report: id });
  const raw = await fs.readFile(path.join(root, report.path), 'utf8');
  const marker = '\n## Report\n\n';
  const index = raw.indexOf(marker);
  const text = index >= 0 ? raw.slice(index + marker.length).replace(/\n+$/, '') : raw;
  return { ...report, text, raw };
}

export async function taskReportSummary(root, taskId) {
  const reports = await listTaskReports(root, { taskId });
  return {
    count: reports.length,
    latest: reports.at(-1)
      ? { id: reports.at(-1).id, at: reports.at(-1).at, path: reports.at(-1).path, by: reports.at(-1).by }
      : null
  };
}

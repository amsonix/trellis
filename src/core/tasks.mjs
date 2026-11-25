import path from 'node:path';
import { ROLES, TASK_STATUSES, TASK_PRIORITIES, TASK_PRIORITY_RANK, META_DIR } from './constants.mjs';
import { ARTIFACTS } from './artifacts.mjs';
import { makeCheck } from './checks.mjs';
import { UsageError } from './errors.mjs';
import {
  exists,
  readText,
  parseMarkdownTable,
  parseScope,
  isSafeDomain,
  splitSections,
  normalizeHeading,
  normalizeSource,
  splitTableRow,
  writeText
} from './util.mjs';

export const TASKS_FILE = 'docs/TASKS.md';
export const TASK_HEADERS = [
  'ID',
  'Milestone',
  'Title',
  'Role',
  'Scope',
  'Depends on',
  'Acceptance',
  'Verification',
  'Status',
  'Priority'
];

const HEADER_ALIASES = {
  id: 'id',
  milestone: 'milestone',
  title: 'title',
  role: 'role',
  scope: 'scope',
  dependson: 'dependsOn',
  depends: 'dependsOn',
  dependencies: 'dependsOn',
  acceptance: 'acceptance',
  verification: 'verification',
  status: 'status',
  priority: 'priority',
  created: 'createdAt',
  createdat: 'createdAt',
  parent: 'parent',
  source: 'source'
};

function normalizeHeader(value) {
  return String(value)
    .toLowerCase()
    .replace(/[\s_.:-]+/g, '');
}

function parseDepends(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return [];
  return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
}

function splitRow(line) {
  return splitTableRow(line);
}

export async function parseTasks(root) {
  const file = path.join(root, META_DIR, TASKS_FILE);
  if (!(await exists(file))) {
    return { tasks: [], error: { code: 'TASKS_MISSING', message: `${TASKS_FILE} does not exist` } };
  }
  const text = await readText(file);
  const table = parseMarkdownTable(text);
  if (!table) {
    return { tasks: [], error: { code: 'TASKS_TABLE_MISSING', message: `${TASKS_FILE} has no Markdown table` } };
  }

  const mapping = {};
  table.headers.forEach((header, index) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (key) mapping[key] = index;
  });
  const missing = ['id', 'milestone', 'title', 'role', 'scope', 'dependsOn', 'acceptance', 'verification', 'status']
    .filter((key) => mapping[key] === undefined);
  if (missing.length > 0) {
    return {
      tasks: [],
      error: {
        code: 'TASKS_HEADER_INVALID',
        message: `${TASKS_FILE} is missing columns: ${missing.join(', ')}`,
        headers: table.headers
      }
    };
  }

  const tasks = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    const row = table.rows[index];
    if (row.every((cell) => !cell)) continue;
    if (row[0].startsWith('<!--')) continue;
    const id = row[mapping.id]?.trim();
    if (!id) continue;
    const rowMisaligned = row.length !== table.headers.length;
    tasks.push({
      id,
      milestone: row[mapping.milestone]?.trim() ?? '',
      title: row[mapping.title]?.trim() ?? '',
      role: row[mapping.role]?.trim().toLowerCase() ?? '',
      scope: parseScope(row[mapping.scope]),
      dependsOn: parseDepends(row[mapping.dependsOn]),
      acceptance: row[mapping.acceptance]?.trim() ?? '',
      verification: row[mapping.verification]?.trim() ?? '',
      status: ((row[mapping.status]?.trim().toLowerCase() || 'todo').split(/[\s—–:()]+/)[0] || 'todo'),
      statusValid: TASK_STATUSES.includes((row[mapping.status]?.trim().toLowerCase() || 'todo').split(/[\s—–:()]+/)[0] || 'todo'),
      priority: (row[mapping.priority]?.trim().toLowerCase() || 'medium'),
      priorityValid: TASK_PRIORITIES.includes((row[mapping.priority]?.trim().toLowerCase() || 'medium')),
      createdAt: row[mapping.createdAt]?.trim() || null,
      rowMisaligned,
      rowCells: row.length,
      expectedCells: table.headers.length,
      parent: (() => {
        const raw = row[mapping.parent]?.trim();
        return raw && raw !== '-' ? raw : null;
      })(),
      source: (() => {
        const raw = row[mapping.source]?.trim();
        return raw && raw !== '-' ? normalizeSource(raw) : null;
      })(),
      row: table.start + 2 + index
    });
  }
  return { tasks, error: null };
}

export function taskById(tasks, id) {
  return tasks.find((task) => task.id === id);
}

function dependencyClosure(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const closure = new Map();
  function visit(id, seen = new Set()) {
    if (closure.has(id)) return closure.get(id);
    if (seen.has(id)) return new Set();
    seen.add(id);
    const result = new Set();
    const task = byId.get(id);
    if (task) {
      for (const dependency of task.dependsOn) {
        result.add(dependency);
        for (const nested of visit(dependency, seen)) result.add(nested);
      }
    }
    closure.set(id, result);
    return result;
  }
  for (const task of tasks) visit(task.id);
  return closure;
}

export async function milestonesFromRoadmap(root) {
  const file = path.join(root, META_DIR, 'docs/ROADMAP.md');
  if (!(await exists(file))) return [];
  const text = await readText(file);
  const sections = splitSections(text);
  return sections
    .filter((section) => /^m\d+\b/.test(section.key) || /^m\d+\b/.test(normalizeHeading(section.title)))
    .map((section) => {
      const statusLine = section.content
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /^\*\*Status:\*\*/i.test(line));
      const declared = statusLine
        ? statusLine.replace(/^\*\*Status:\*\*/i, '').trim().split(/[\s(—–-]+/)[0].toLowerCase()
        : 'planned';
      const criteria = section.content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s*\[[ xX]\]\s+/.test(line))
        .map((line, index) => ({
          index: index + 1,
          text: line.replace(/^[-*]\s*\[[ xX]\]\s+/, '').trim(),
          checked: /\[[xX]\]/.test(line)
        }));
      return {
        id: section.title.split(/\s+/)[0],
        title: section.title,
        key: section.key,
        content: section.content,
        declared,
        criteria
      };
    });
}

export function validateTasks(tasks, { milestones = [] } = {}) {
  const checks = [];
  const add = (code, severity, message, extra = {}) => {
    checks.push(makeCheck(code, severity, message, { stage: 'ready', ...extra }));
  };

  if (tasks.length === 0) {
    add('TASKS_EMPTY', 'fail', 'the task table has no tasks');
    return checks;
  }

  const seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) add('TASK_ID_DUPLICATE', 'fail', `duplicate task id '${task.id}'`, { task: task.id });
    seen.add(task.id);
  }

  const ids = new Set(tasks.map((task) => task.id));
  const parentById = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    if (task.parent) {
      if (task.parent === task.id) {
        add('TASK_PARENT_SELF', 'fail', `task ${task.id} cannot be its own parent`, { task: task.id });
      } else if (!parentById.has(task.parent)) {
        add('TASK_PARENT_UNKNOWN', 'fail', `task ${task.id} has unknown parent '${task.parent}'`, { task: task.id, parent: task.parent });
      } else {
        const parent = parentById.get(task.parent);
        if (['done', 'canceled'].includes(parent.status)) {
          add('TASK_PARENT_CLOSED', 'fail', `task ${task.id} has parent ${parent.id} which is already ${parent.status}`, { task: task.id, parent: parent.id });
        }
        for (const domain of task.scope) {
          if (!parent.scope.some((prefix) => domain === prefix || domain.startsWith(`${prefix}/`))) {
            add('TASK_PARENT_SCOPE', 'fail', `task ${task.id} scope '${domain}' is outside parent ${parent.id}`, { task: task.id, parent: parent.id });
          }
        }
        let cursor = parent;
        let depth = 1;
        const chain = new Set([task.id]);
        while (cursor) {
          if (chain.has(cursor.id)) {
            add('TASK_PARENT_CYCLE', 'fail', `task ${task.id} parent chain has a cycle`, { task: task.id });
            break;
          }
          chain.add(cursor.id);
          if (depth > 2) {
            add('TASK_PARENT_DEPTH', 'fail', `task ${task.id} parent chain is deeper than 2`, { task: task.id });
            break;
          }
          cursor = cursor.parent ? parentById.get(cursor.parent) : null;
          depth += 1;
        }
      }
    }
  }
  for (const task of tasks) {
    if (task.source) {
      for (const part of task.source.split(',')) {
        const match = /^([A-Z]+)#(.+)$/.exec(part);
        if (!match) {
          add('TASK_SOURCE_INVALID', 'fail', `task ${task.id} source '${part}' must look like ROADMAP#M2/exit-1`, { task: task.id });
        } else if (match[1] !== 'ADR' && match[1] !== 'RECORD' && !ARTIFACTS[match[1]]) {
          add('TASK_SOURCE_INVALID', 'fail', `task ${task.id} source names unknown artifact '${match[1]}'`, { task: task.id });
        } else if (match[1] === 'RECORD') {
          if (!/^R-\d+$/.test(match[2])) {
            add('TASK_SOURCE_INVALID', 'fail', `task ${task.id} source '${part}' names no record`, { task: task.id });
          }
        } else if (match[1] === 'ROADMAP') {
          const [milestoneId, criterion] = match[2].split('/');
          const milestone = milestones.find((item) => item.id === milestoneId);
          if (!milestone) {
            add('TASK_SOURCE_INVALID', 'fail', `task ${task.id} source names unknown milestone '${milestoneId}'`, { task: task.id });
          } else if (criterion) {
            const exit = /^exit-(\d+)$/.exec(criterion);
            if (!exit || Number(exit[1]) < 1 || Number(exit[1]) > (milestone.criteria ?? []).length) {
              add('TASK_SOURCE_INVALID', 'fail', `task ${task.id} source '${part}' names no exit criterion`, { task: task.id });
            }
          }
        }
      }
    }
    if (!/^T-\d+$/.test(task.id)) {
      add('TASK_ID_FORMAT', 'warn', `task id '${task.id}' does not look like T-001`, { task: task.id });
    }
    if (!ROLES.includes(task.role)) {
      add('TASK_ROLE_INVALID', 'fail', `task ${task.id} has unknown role '${task.role}'`, { task: task.id });
    }
    if (task.rowMisaligned) {
      add(
        'ROW_MISALIGNED',
        'fail',
        `task ${task.id} row has ${task.rowCells} cells; the header has ${task.expectedCells}`,
        { task: task.id, cells: task.rowCells, expected: task.expectedCells }
      );
    }
    if (!TASK_STATUSES.includes(task.status)) {
      add('TASK_STATUS_INVALID', 'fail', `task ${task.id} has unknown status '${task.status}'`, { task: task.id });
    }
    if (task.scope.length === 0) {
      add('TASK_SCOPE_EMPTY', 'fail', `task ${task.id} has no write scope`, { task: task.id });
    }
    for (const domain of task.scope) {
      if (!isSafeDomain(domain)) {
        add(
          'TASK_SCOPE_INVALID',
          'fail',
          `task ${task.id} has an unsafe write scope '${domain}'; use a relative path without '..', '*' or an absolute path`,
          { task: task.id, domain }
        );
      }
    }
    if (!task.acceptance) {
      add('TASK_ACCEPTANCE_EMPTY', 'fail', `task ${task.id} has no acceptance criterion`, { task: task.id });
    }
    if (!task.verification) {
      add('TASK_VERIFICATION_EMPTY', 'fail', `task ${task.id} has no verification method`, { task: task.id });
    }
    if (!TASK_PRIORITIES.includes(task.priority)) {
      add('TASK_PRIORITY_INVALID', 'fail', `task ${task.id} has unknown priority '${task.priority}'`, { task: task.id });
    }
    if (!task.milestone) {
      add('TASK_MILESTONE_EMPTY', 'fail', `task ${task.id} has no milestone`, { task: task.id });
    } else if (milestones.length > 0 && !milestones.some((milestone) => milestone.id === task.milestone)) {
      add('TASK_MILESTONE_UNKNOWN', 'fail', `task ${task.id} points at unknown milestone '${task.milestone}'`, { task: task.id });
    }
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) {
        add('TASK_DEPENDS_ON_SELF', 'fail', `task ${task.id} depends on itself`, { task: task.id });
      } else if (!ids.has(dependency)) {
        add('TASK_DEPENDENCY_UNKNOWN', 'fail', `task ${task.id} depends on unknown task '${dependency}'`, {
          task: task.id,
          dependency
        });
      }
    }
  }

  // Cycle detection: 0 = unvisited, 1 = in stack, 2 = done.
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const color = new Map();
  const cycles = [];
  function visit(id, stack) {
    const state = color.get(id) ?? 0;
    if (state === 2) return;
    if (state === 1) {
      cycles.push([...stack.slice(stack.indexOf(id)), id].join(' -> '));
      return;
    }
    color.set(id, 1);
    const task = byId.get(id);
    if (task) {
      for (const dependency of task.dependsOn) {
        if (byId.has(dependency)) visit(dependency, [...stack, id]);
      }
    }
    color.set(id, 2);
  }
  for (const task of tasks) visit(task.id, []);
  for (const cycle of cycles) {
    add('TASK_CYCLE', 'fail', `task graph has a cycle: ${cycle}`);
  }

  // Two tasks that may run concurrently must not share a write domain unless
  // one depends on the other (which serializes them).
  const closure = dependencyClosure(tasks);
  const active = tasks.filter((task) => ['todo', 'ready', 'in_progress'].includes(task.status));
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      const ordered = closure.get(a.id)?.has(b.id) || closure.get(b.id)?.has(a.id);
      if (ordered) continue;
      const isAncestor = (ancestor, descendant) => {
        let cursor = byId.get(descendant.parent);
        while (cursor) {
          if (cursor.id === ancestor.id) return true;
          cursor = cursor.parent ? byId.get(cursor.parent) : null;
        }
        return false;
      };
      if (isAncestor(a, b) || isAncestor(b, a)) continue;
      for (const left of a.scope) {
        for (const right of b.scope) {
          const coversLeft = left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
          if (coversLeft) {
            add(
              'TASK_SCOPE_OVERLAP',
              'fail',
              `tasks ${a.id} and ${b.id} can run concurrently but share a write domain (${left} / ${right}); add a dependency or narrow the scope`,
              { tasks: [a.id, b.id], domains: [left, right] }
            );
          }
        }
      }
    }
  }

  return checks;
}

export function readyTasks(tasks, role) {
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id));
  return tasks
    .filter((task) => ['todo', 'ready'].includes(task.status))
    .filter((task) => task.dependsOn.every((dependency) => done.has(dependency)))
    .filter((task) => !role || task.role === role)
    .sort((a, b) => {
      const rank = (TASK_PRIORITY_RANK[a.priority] ?? 1) - (TASK_PRIORITY_RANK[b.priority] ?? 1);
      if (rank !== 0) return rank;
      // Older first; a missing date is treated as the oldest.
      const aDate = a.createdAt ?? '0000-00-00';
      const bDate = b.createdAt ?? '0000-00-00';
      const byAge = aDate.localeCompare(bDate);
      return byAge !== 0 ? byAge : a.id.localeCompare(b.id);
    });
}

export function nextTaskId(tasks) {
  const highest = tasks
    .map((task) => /^T-(\d+)$/.exec(task.id))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .reduce((max, value) => Math.max(max, value), 0);
  return `T-${String(highest + 1).padStart(3, '0')}`;
}

export async function appendTask(root, task) {
  const file = path.join(root, META_DIR, TASKS_FILE);
  const text = await readText(file);
  const lines = text.split(/\r?\n/);
  let lastRow = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\|/.test(lines[i])) lastRow = i;
  }
  if (lastRow === -1) throw new UsageError(`${TASKS_FILE} has no Markdown table to append to`);
  const headerLine = lines.find((line) => /^\s*\|/.test(line));
  const headerCells = headerLine ? splitRow(headerLine) : [];
  const hasPriority = headerCells.some((cell) => HEADER_ALIASES[normalizeHeader(cell)] === 'priority');
  const cells = [
    task.id,
    task.milestone,
    task.title,
    task.role,
    task.scope.join(', '),
    task.dependsOn.length > 0 ? task.dependsOn.join(', ') : '-',
    task.acceptance,
    task.verification,
    task.status
  ];
  if (hasPriority) {
    cells.push(task.priority ?? 'medium');
  } else if ((task.priority ?? 'medium') !== 'medium') {
    throw new UsageError(
      `${TASKS_FILE} has no 'priority' column; append it as the last column (Trellis reads by header name; appending keeps positional readers stable)`
    );
  }
  const hasCreated = headerCells.some((cell) => HEADER_ALIASES[normalizeHeader(cell)] === 'createdAt');
  if (hasCreated) cells.push(task.createdAt ?? new Date().toISOString().slice(0, 10));
  const hasParent = headerCells.some((cell) => HEADER_ALIASES[normalizeHeader(cell)] === 'parent');
  if (hasParent) cells.push(task.parent ?? '-');
  const hasSource = headerCells.some((cell) => HEADER_ALIASES[normalizeHeader(cell)] === 'source');
  if (hasSource) cells.push(task.source ?? '-');
  lines.splice(lastRow + 1, 0, `| ${cells.join(' | ')} |`);
  await writeText(file, lines.join('\n'));
}

export async function updateTaskFields(root, id, fields) {
  const file = path.join(root, META_DIR, TASKS_FILE);
  const text = await readText(file);
  const lines = text.split(/\r?\n/);
  const mapping = {};
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) continue;
    const header = splitRow(line);
    header.forEach((cell, index) => {
      const key = HEADER_ALIASES[normalizeHeader(cell)];
      if (key) mapping[key] = index;
    });
    break;
  }
  for (const key of Object.keys(fields)) {
    if (mapping[key] === undefined) {
      throw new UsageError(
        `${TASKS_FILE} has no '${key}' column; append it as the last column (Trellis reads by header name; appending keeps positional readers stable)`
      );
    }
  }
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const cells = splitRow(lines[i]);
    if (cells[0] !== id) continue;
    for (const [key, value] of Object.entries(fields)) {
      const index = mapping[key];
      if (index >= cells.length) {
        throw new UsageError(`row ${id} has no cell for '${key}'; fix ${TASKS_FILE}`);
      }
      cells[index] = value;
    }
    lines[i] = `| ${cells.join(' | ')} |`;
    changed = true;
    break;
  }
  if (!changed) throw new UsageError(`task ${id} is not on the task board`);
  await writeText(file, lines.join('\n'));
}

export async function updateTaskScope(root, id, scope) {
  const file = path.join(root, META_DIR, TASKS_FILE);
  const text = await readText(file);
  const lines = text.split(/\r?\n/);
  let scopeIndex = -1;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) continue;
    const header = splitRow(line);
    const found = header.findIndex((cell) => HEADER_ALIASES[normalizeHeader(cell)] === 'scope');
    if (found !== -1) {
      scopeIndex = found;
      break;
    }
  }
  if (scopeIndex === -1) throw new UsageError(`${TASKS_FILE} has no Scope column`);
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const cells = splitRow(lines[i]);
    if (cells[0] !== id) continue;
    if (cells.length <= scopeIndex) continue;
    cells[scopeIndex] = scope.join(', ');
    lines[i] = `| ${cells.join(' | ')} |`;
    changed = true;
    break;
  }
  if (!changed) throw new UsageError(`task ${id} is not on the task board`);
  await writeText(file, lines.join('\n'));
}

export async function updateTaskStatus(root, id, status) {
  const file = path.join(root, META_DIR, TASKS_FILE);
  const text = await readText(file);
  const lines = text.split(/\r?\n/);
  let statusIndex = -1;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) continue;
    const header = splitRow(line);
    const found = header.findIndex((cell) => HEADER_ALIASES[normalizeHeader(cell)] === 'status');
    if (found !== -1) {
      statusIndex = found;
      break;
    }
  }
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const cells = splitRow(lines[i]);
    if (cells[0] !== id) continue;
    if (cells.length < 2) continue;
    cells[statusIndex === -1 ? cells.length - 1 : statusIndex] = status;
    lines[i] = `| ${cells.join(' | ')} |`;
    changed = true;
    break;
  }
  if (!changed) return false;
  await writeText(file, lines.join('\n'));
  return true;
}

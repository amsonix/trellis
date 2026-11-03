import path from 'node:path';
import { ROLES, TASK_STATUSES } from './constants.mjs';
import { makeCheck } from './checks.mjs';
import {
  exists,
  readText,
  parseMarkdownTable,
  parseScope,
  splitSections,
  normalizeHeading,
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
  'Status'
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
  status: 'status'
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
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export async function parseTasks(root) {
  const file = path.join(root, TASKS_FILE);
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
    tasks.push({
      id,
      milestone: row[mapping.milestone]?.trim() ?? '',
      title: row[mapping.title]?.trim() ?? '',
      role: row[mapping.role]?.trim().toLowerCase() ?? '',
      scope: parseScope(row[mapping.scope]),
      dependsOn: parseDepends(row[mapping.dependsOn]),
      acceptance: row[mapping.acceptance]?.trim() ?? '',
      verification: row[mapping.verification]?.trim() ?? '',
      status: (row[mapping.status]?.trim().toLowerCase() || 'todo'),
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
  const file = path.join(root, 'docs/ROADMAP.md');
  if (!(await exists(file))) return [];
  const text = await readText(file);
  const sections = splitSections(text);
  return sections
    .filter((section) => /^m\d+\b/.test(section.key) || /^m\d+\b/.test(normalizeHeading(section.title)))
    .map((section) => ({
      id: section.title.split(/\s+/)[0],
      title: section.title,
      key: section.key,
      content: section.content
    }));
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
  for (const task of tasks) {
    if (!/^T-\d+$/.test(task.id)) {
      add('TASK_ID_FORMAT', 'warn', `task id '${task.id}' does not look like T-001`, { task: task.id });
    }
    if (!ROLES.includes(task.role)) {
      add('TASK_ROLE_INVALID', 'fail', `task ${task.id} has unknown role '${task.role}'`, { task: task.id });
    }
    if (!TASK_STATUSES.includes(task.status)) {
      add('TASK_STATUS_INVALID', 'fail', `task ${task.id} has unknown status '${task.status}'`, { task: task.id });
    }
    if (task.scope.length === 0) {
      add('TASK_SCOPE_EMPTY', 'fail', `task ${task.id} has no write scope`, { task: task.id });
    }
    if (!task.acceptance) {
      add('TASK_ACCEPTANCE_EMPTY', 'fail', `task ${task.id} has no acceptance criterion`, { task: task.id });
    }
    if (!task.verification) {
      add('TASK_VERIFICATION_EMPTY', 'fail', `task ${task.id} has no verification method`, { task: task.id });
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
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function updateTaskStatus(root, id, status) {
  const file = path.join(root, TASKS_FILE);
  const text = await readText(file);
  const lines = text.split(/\r?\n/);
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const cells = splitRow(lines[i]);
    if (cells[0] !== id) continue;
    if (cells.length < 2) continue;
    cells[cells.length - 1] = status;
    lines[i] = `| ${cells.join(' | ')} |`;
    changed = true;
    break;
  }
  if (!changed) return false;
  await writeText(file, lines.join('\n'));
  return true;
}

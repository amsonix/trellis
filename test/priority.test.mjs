import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addTask } from '../src/core/project.mjs';
import { parseTasks, readyTasks } from '../src/core/tasks.mjs';
import { cleanup, makeProject } from './helpers.mjs';

test('priority defaults to medium and orders ready tasks', async () => {
  const dir = await makeProject('generic');
  try {
    await addTask(dir, { title: 'Low work', scope: 'docs/low', acceptance: 'a', verification: 'v', priority: 'low', by: 'coordinator:kim' });
    await addTask(dir, { title: 'High work', scope: 'docs/high', acceptance: 'a', verification: 'v', priority: 'high', by: 'coordinator:kim' });
    await addTask(dir, { title: 'Default work', scope: 'docs/default', acceptance: 'a', verification: 'v', by: 'coordinator:kim' });

    const { tasks } = await parseTasks(dir);
    assert.equal(tasks.find((task) => task.id === 'T-004').priority, 'medium');
    assert.deepEqual(readyTasks(tasks, 'executor').map((task) => task.id), ['T-003', 'T-001', 'T-004', 'T-002']);
  } finally {
    await cleanup(dir);
  }
});

test('an unknown priority is refused', async () => {
  const dir = await makeProject('generic');
  try {
    await assert.rejects(
      () => addTask(dir, { title: 'Bad', scope: 'docs/bad', acceptance: 'a', verification: 'v', priority: 'urgent', by: 'coordinator:kim' }),
      /priority/
    );
  } finally {
    await cleanup(dir);
  }
});

test('a task board without a Priority column still parses as medium', async () => {
  const dir = await makeProject('generic');
  try {
    const file = path.join(dir, '.trellis/docs/TASKS.md');
    const text = await readFile(file, 'utf8');
    const old = text
      .split('\n')
      .map((line) => {
        if (!line.startsWith('|')) return line;
        const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
        if (cells.length < 10) return line;
        return `| ${cells.slice(0, 9).join(' | ')} |`;
      })
      .join('\n');
    await writeFile(file, old);
    const { tasks, error } = await parseTasks(dir);
    assert.equal(error, null);
    assert.equal(tasks[0].priority, 'medium');
  } finally {
    await cleanup(dir);
  }
});

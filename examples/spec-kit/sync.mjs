#!/usr/bin/env node
/**
 * Capture bridge: Spec Kit `tasks.md` → Trellis task board.
 *
 * Parses unchecked checklist items and creates one Trellis task per item. The
 * task title is prefixed with the source id so a second run is idempotent.
 * Acceptance is a placeholder on purpose: a human must refine it before the
 * task is claimed.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { addTask } from '../../src/core/mutations.mjs';
import { parseTasks } from '../../src/core/tasks.mjs';

export function parseSpecTasks(text) {
  const tasks = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*-\s*\[([ xX])\]\s*(T\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const title = match[3]
      .replace(/^\[P\]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) continue;
    tasks.push({ id: match[2], title, done: match[1].toLowerCase() === 'x' });
  }
  return tasks;
}

export async function syncTasks(
  root,
  text,
  { by = 'coordinator:spec-kit', scope, verification = 'npm test', milestone = null, dryRun = false } = {}
) {
  if (!scope) throw new Error('syncTasks needs a write scope');
  const open = parseSpecTasks(text).filter((task) => !task.done);
  const existing = new Set((await parseTasks(root)).tasks.map((task) => task.title));
  const created = [];
  const skipped = [];
  let previous = null;

  for (const item of open) {
    const title = `[${item.id}] ${item.title}`;
    if (existing.has(title)) {
      skipped.push(item.id);
      continue;
    }
    if (dryRun) {
      created.push({ source: item.id, title });
      continue;
    }
    const result = await addTask(root, {
      title,
      role: 'executor',
      scope,
      milestone,
      dependsOn: previous ? [previous] : [],
      acceptance: `Spec Kit ${item.id} is implemented and its acceptance is checked`,
      verification,
      by
    });
    existing.add(title);
    previous = result.task.id;
    created.push({ source: item.id, id: result.task.id });
  }
  return { created, skipped };
}

function parseArgv(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') {
      options.dryRun = true;
      continue;
    }
    options[key] = argv[i + 1];
    i += 1;
  }
  return options;
}

async function main() {
  const options = parseArgv(process.argv.slice(2));
  if (!options.dir || !options.file || !options.scope) {
    console.error('usage: sync.mjs --dir <project> --file <tasks.md> --scope <paths> [--verification <cmd>] [--by <role:name>] [--milestone <M0>] [--dry-run]');
    process.exit(2);
  }
  const text = await readFile(path.resolve(options.file), 'utf8');
  const result = await syncTasks(path.resolve(options.dir), text, {
    by: options.by ?? 'coordinator:spec-kit',
    scope: options.scope,
    verification: options.verification ?? 'npm test',
    milestone: options.milestone ?? null,
    dryRun: Boolean(options.dryRun)
  });
  for (const item of result.created) console.log(`created ${item.id ?? item.title} (source ${item.source})`);
  for (const id of result.skipped) console.log(`skipped ${id} (already on the board)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

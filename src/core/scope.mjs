import { covers } from './util.mjs';

/**
 * Turn the files a task actually touched into a narrower scope.
 *
 * Pure: the caller supplies the file list (normally from
 * `git log --name-only --grep=T-NNN`). Paths outside the current scope are
 * reported separately so a drifting task is visible instead of silently
 * ignored.
 */
export function suggestScopeForTask(taskId, currentScope, files) {
  const touched = [...new Set((files ?? []).map((file) => String(file).trim()).filter(Boolean))]
    .filter((file) => file !== '.trellis' && !file.startsWith('.trellis/'))
    .sort();

  const inside = touched.filter((file) => currentScope.some((prefix) => covers(prefix, file)));
  const outside = touched.filter((file) => !inside.includes(file));

  return {
    taskId,
    current: [...currentScope],
    suggested: inside,
    outside,
    touched: touched.length,
    narrows: inside.length > 0
  };
}

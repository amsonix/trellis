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


/**
 * Keep only commits whose message contains the task id as an exact token.
 *
 * `git log --grep=T-001` is a substring match, so it also matches T-0010 and
 * unrelated text. The caller supplies parsed commits; this keeps the matching
 * rule testable without git.
 */
export function selectTaskCommits(commits, taskId) {
  const escaped = String(taskId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`);
  return (commits ?? []).filter((commit) => exact.test(commit.body ?? ''));
}

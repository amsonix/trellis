/**
 * Environment and ledger diagnostics.
 *
 * `doctor` must never throw for a broken project: it reports what it found and
 * lets the caller decide the exit code.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadState, STATE_DIR } from './store.mjs';
import { parseTasks } from './tasks.mjs';
import { readEvidenceEvents } from './evidence.mjs';
import { makeCheck, summarize } from './checks.mjs';

export async function doctor(root) {
  const checks = [];
  const add = (code, severity, message, extra = {}) =>
    checks.push(makeCheck(code, severity, message, { stage: 'maintained', ...extra }));

  try {
    const state = await loadState(root);
    add('STATE_OK', 'pass', `state schema ${state.schemaVersion}, profile ${state.project.profile}`);
  } catch (error) {
    add('STATE_BROKEN', 'fail', error.message);
  }

  const parsed = await parseTasks(root);
  if (parsed.error) add('TASKS_BROKEN', 'fail', parsed.error.message);
  else add('TASKS_OK', 'pass', `${parsed.tasks.length} task(s) parsed`);

  try {
    const events = await readEvidenceEvents(root);
    add('EVIDENCE_OK', 'pass', `${events.length} evidence event(s)`);
  } catch (error) {
    add('EVIDENCE_BROKEN', 'fail', error.message);
  }

  const leasesFile = path.join(root, STATE_DIR, 'leases.json');
  try {
    const ledger = JSON.parse(await fs.readFile(leasesFile, 'utf8'));
    if (!Array.isArray(ledger.items)) throw new Error('leases.json has no items array');
    add('LEASES_OK', 'pass', `${ledger.items.length} held lease(s)`);
  } catch (error) {
    if (error.code === 'ENOENT') add('LEASES_OK', 'pass', 'no leases file');
    else add('LEASES_BROKEN', 'fail', error.message);
  }

  const lockFile = path.join(root, '.trellis/.lock');
  try {
    const stat = await fs.stat(lockFile);
    const age = Date.now() - stat.mtimeMs;
    add(
      age > 20_000 ? 'LOCK_STALE' : 'LOCK_HELD',
      'warn',
      `lock file present, ${Math.round(age / 1000)}s old`
    );
  } catch (error) {
    if (error.code !== 'ENOENT') add('LOCK_UNREADABLE', 'fail', error.message);
  }

  try {
    await fs.access(root, fs.constants.W_OK);
    add('WRITABLE_OK', 'pass', 'project directory is writable');
  } catch {
    add('WRITABLE_FAIL', 'fail', 'project directory is not writable');
  }

  return { root, checks, summary: summarize(checks) };
}

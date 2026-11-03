/**
 * Cross-process, re-entrant lock for one project's ledger.
 *
 * A lock file at `.trellis/.lock` serializes processes; an AsyncLocalStorage
 * marker lets the same async call stack re-enter (e.g. `claimTask` calling
 * `acquireLease`) without deadlocking, while parallel calls in the same process
 * queue behind each other.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const LOCK_FILE = '.trellis/.lock';
const STALE_MS = 10_000;
const TIMEOUT_MS = 10_000;
const RETRY_MS = 10;

const held = new AsyncLocalStorage();
const tails = new Map();

async function acquire(root) {
  const file = path.join(root, LOCK_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await fs.open(file, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      return async () => {
        await handle.close();
        await fs.rm(file, { force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs > STALE_MS) {
          await fs.rm(file, { force: true });
          continue;
        }
      } catch {
        // The holder removed it between open and stat; retry immediately.
      }
      if (Date.now() - started > TIMEOUT_MS) {
        throw new Error(`timed out waiting for the ledger lock at ${file}`);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

export function withLock(root, fn) {
  const key = path.resolve(root);
  if (held.getStore()?.has(key)) return fn();

  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(async () => {
    const release = await acquire(key);
    try {
      return await held.run(new Set([key]), fn);
    } finally {
      await release();
    }
  });
  tails.set(
    key,
    run.then(
      () => {},
      () => {}
    )
  );
  return run;
}

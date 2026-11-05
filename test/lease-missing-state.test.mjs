import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cleanup } from './helpers.mjs';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/trellis.mjs', import.meta.url));

test('lease release outside a project reports UNAVAILABLE, not LEASE_NOT_HELD', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'trellis-empty-'));
  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, [bin, 'lease', 'release', 'T-001', '--by', 'human:alice', '--dir', dir, '--json']),
      (error) => {
        const body = JSON.parse(error.stdout);
        return body.error?.code === 'UNAVAILABLE';
      }
    );
  } finally {
    await cleanup(dir);
  }
});

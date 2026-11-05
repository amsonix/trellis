import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const special = new Set(['profile:list', 'scope:suggest']);

test('every help subcommand has a dispatcher branch', async () => {
  const source = await readFile(cli, 'utf8');
  const keys = [...source.matchAll(/^  '([a-z]+):([a-z-]+)'/gm)].map((match) => `${match[1]}:${match[2]}`);
  assert.ok(keys.length >= 15, 'help table was not found');
  for (const key of keys) {
    if (special.has(key)) continue;
    const sub = key.split(':')[1];
    assert.ok(
      source.includes(`subcommand === '${sub}'`),
      `${key} is in the help table but has no dispatcher branch`
    );
  }
});

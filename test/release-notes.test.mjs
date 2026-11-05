import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('CHANGELOG documents the current version and the 0.7+ releases', async () => {
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
  const changelog = await readFile(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes(`## [${pkg.version}]`), `CHANGELOG has no section for ${pkg.version}`);
  for (const version of ['0.7.0', '0.8.0', '0.9.0', '0.9.5', '0.9.6', '0.9.7', '0.9.8']) {
    assert.ok(changelog.includes(`## [${version}]`), `CHANGELOG has no section for ${version}`);
  }
});

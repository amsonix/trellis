#!/usr/bin/env node
/**
 * Build the publishable tarball into dist/.
 *
 * `npm pack` is used so the `files` list in package.json stays the single
 * source of truth. A temporary npm cache is used by default because a broken
 * global cache should not block a release.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'dist');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

await mkdir(out, { recursive: true });

const env = {
  ...process.env,
  npm_config_cache: process.env.npm_config_cache ?? path.join(os.tmpdir(), 'trellis-npm-cache')
};

const git = (args) => execFileAsync('git', args, { cwd: root });
const commit = (await git(['rev-parse', '--short', 'HEAD'])).stdout.trim();
let tag = null;
try {
  tag = (await git(['describe', '--tags', '--exact-match'])).stdout.trim();
} catch {
  // HEAD is not tagged: this is a development build.
}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const expectedTag = `v${pkg.version}`;
if (tag !== expectedTag) {
  console.warn(
    tag
      ? `warning: HEAD is tagged ${tag}, not ${expectedTag}; the tarball does not match package.json`
      : `warning: HEAD is not tagged; ${pkg.version} is a development build, not a release`
  );
}

const { stdout } = await execFileAsync(npm, ['pack', '--pack-destination', out], { cwd: root, env });
const name = stdout.trim().split('\n').pop();
const file = path.join(out, name);
const bytes = await readFile(file);
const sha256 = createHash('sha256').update(bytes).digest('hex');

console.log(file);
console.log(`commit  ${commit}${tag ? ` (${tag})` : ' (untagged)'}`);
console.log(`sha256  ${sha256}`);
console.log(`size    ${bytes.length} bytes`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

function setMembers(source, name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(match, `${name} not found`);
  return new Set([...match[1].matchAll(/'([a-z0-9-]+)'/g)].map((item) => item[1]));
}

export function auditHelp(source) {
  const accepted = new Set([...setMembers(source, 'VALUE_OPTIONS'), ...setMembers(source, 'FLAG_OPTIONS')]);
  const usages = [...source.matchAll(/'(trellis [^']*)'/g)].map((match) => match[1]);
  assert.ok(usages.length > 0, 'no usage strings found');
  const documented = new Set();
  for (const usage of usages) {
    for (const match of usage.matchAll(/--([a-z0-9-]+)/g)) documented.add(match[1]);
  }
  for (const option of documented) {
    assert.ok(accepted.has(option), `help documents --${option}, but the parser rejects it`);
  }
  const global = new Set(['dir', 'json', 'help', 'version']);
  const missing = [...accepted].filter((option) => !global.has(option) && !documented.has(option));
  assert.deepEqual(missing, [], `the parser accepts undocumented options: ${missing.join(', ')}`);
  return { documented, accepted };
}

test('help options and the argument parser agree', async () => {
  const source = await readFile(cli, 'utf8');
  const { documented } = auditHelp(source);
  assert.ok(documented.has('status'));
});

test('the audit rejects a documented option the parser does not accept', () => {
  const source = `
const VALUE_OPTIONS = new Set(['known']);
const FLAG_OPTIONS = new Set([]);
const HELP = { x: ['d', 'trellis x --bogus'] };
`;
  assert.throws(() => auditHelp(source), /help documents --bogus/);
});

test('the audit rejects an accepted option no help text mentions', () => {
  const source = `
const VALUE_OPTIONS = new Set(['known', 'silent']);
const FLAG_OPTIONS = new Set([]);
const HELP = { x: ['d', 'trellis x --known'] };
`;
  assert.throws(() => auditHelp(source), /undocumented options: silent/);
});

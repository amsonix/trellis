#!/usr/bin/env node
/**
 * Runs the test suite with V8 coverage and fails when the totals drop below the
 * thresholds below. `node --test` has no threshold flag, so this is the gate.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const THRESHOLDS = { lines: 80, branches: 60, functions: 70 };

export function parseCoverage(stdout) {
  const row = stdout
    .split('\n')
    .find((line) => line.includes('all files') && line.includes('|'));
  if (!row) return null;
  const [lines, branches, functions] = row
    .split('|')
    .slice(1, 4)
    .map((cell) => Number.parseFloat(cell.trim()));
  if (![lines, branches, functions].every(Number.isFinite)) return null;
  return { lines, branches, functions };
}

export function evaluateCoverage(totals, thresholds = THRESHOLDS) {
  const failures = [];
  if (!(totals.lines >= thresholds.lines)) failures.push(`lines ${totals.lines}% < ${thresholds.lines}%`);
  if (!(totals.branches >= thresholds.branches)) failures.push(`branches ${totals.branches}% < ${thresholds.branches}%`);
  if (!(totals.functions >= thresholds.functions)) failures.push(`functions ${totals.functions}% < ${thresholds.functions}%`);
  return failures;
}

async function main() {
  let stdout = '';
  let stderr = '';
  let code = 0;
  // Windows runners fail the suite under full file-level parallelism; use the
  // same cap as the CI test step so this gate measures coverage, not flakes.
  const concurrency = process.platform === 'win32' ? '1' : '4';
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--test', '--experimental-test-coverage', `--test-concurrency=${concurrency}`],
      { cwd: root, maxBuffer: 64 * 1024 * 1024 }
    ));
  } catch (error) {
    code = error.code ?? 1;
    stdout = error.stdout ?? '';
    stderr = error.stderr ?? '';
  }

  if (code !== 0) {
    const tail = `${stdout}\n${stderr}`.trim().split('\n').slice(-20).join('\n');
    console.error(`coverage-gate: the test suite failed (exit ${code})`);
    if (tail) console.error(tail);
    process.exit(1);
  }

  const totals = parseCoverage(stdout);
  if (!totals) {
    console.error('coverage-gate: no "all files" row in the coverage report');
    process.exit(1);
  }

  const failures = evaluateCoverage(totals);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`coverage-gate: ${failure}`);
    process.exit(1);
  }
  console.log(
    `coverage-gate: ok (lines ${totals.lines}%, branches ${totals.branches}%, functions ${totals.functions}%)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { THRESHOLDS, evaluateCoverage, parseCoverage } from '../scripts/coverage-gate.mjs';

test('the coverage gate parses the all-files row', () => {
  const totals = parseCoverage('ℹ  all files         |  84.40 |  68.38 |  77.00 |');
  assert.deepEqual(totals, { lines: 84.4, branches: 68.38, functions: 77 });
});

test('a missing all-files row is not a pass', () => {
  assert.equal(parseCoverage('ℹ tests 42\nℹ pass 42'), null);
});

test('the coverage gate fails when a total drops below its threshold', () => {
  const totals = { lines: 79, branches: 80, functions: 90 };
  assert.deepEqual(evaluateCoverage(totals), [`lines 79% < ${THRESHOLDS.lines}%`]);
});

test('the coverage gate passes at the thresholds', () => {
  assert.deepEqual(evaluateCoverage({ ...THRESHOLDS }), []);
});

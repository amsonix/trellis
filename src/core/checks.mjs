import { EXIT_CODES, SEVERITIES } from './constants.mjs';

export function makeCheck(code, severity, message, extra = {}) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`unknown severity '${severity}'`);
  }
  return { code, severity, message, ...extra };
}

export function summarize(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, unavailable: 0, total: checks.length };
  for (const check of checks) {
    summary[check.severity] = (summary[check.severity] ?? 0) + 1;
  }
  return summary;
}

export function hasBlocking(checks) {
  return checks.some((check) => check.severity === 'fail' || check.severity === 'unavailable');
}

export function exitCodeFor(checks) {
  if (checks.some((check) => check.severity === 'unavailable')) return EXIT_CODES.UNAVAILABLE;
  if (checks.some((check) => check.severity === 'fail')) return EXIT_CODES.REFUSED;
  return EXIT_CODES.OK;
}

export function worstSeverity(checks) {
  if (checks.some((check) => check.severity === 'unavailable')) return 'unavailable';
  if (checks.some((check) => check.severity === 'fail')) return 'fail';
  if (checks.some((check) => check.severity === 'warn')) return 'warn';
  return 'pass';
}

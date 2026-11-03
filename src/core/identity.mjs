/**
 * Attribution, not authentication.
 *
 * `TRELLIS_AGENT` lets a runtime name the process behind an action (a subagent
 * id, a worker name). It is recorded on leases, evidence and audit entries so a
 * reviewer can see who did what; it is NOT a credential and never grants access.
 */
export function currentAgent() {
  const value = process.env.TRELLIS_AGENT;
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, 120);
}

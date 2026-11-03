/**
 * Public library surface.
 *
 * The CLI is one adapter; this module is the stable import surface for an agent
 * runtime, a git hook or a test harness. Core modules stay free of terminal
 * concerns; `main` lives in `src/cli.mjs`.
 */

export {
  initProject,
  projectStatus,
  runChecks,
  nextAction,
  agentBrief,
  projectReport,
  claimTask,
  addTask,
  reportTask,
  addTaskEvidence,
  verifyTask,
  evidenceFor,
  reindex,
  approveGate,
  waiveGate,
  listProfiles
} from './core/project.mjs';

export {
  parseTasks,
  validateTasks,
  readyTasks,
  taskById,
  updateTaskStatus,
  milestonesFromRoadmap
} from './core/tasks.mjs';

export {
  loadState,
  saveState,
  defaultState,
  statePath,
  appendAudit
} from './core/store.mjs';

export {
  acquireLease,
  releaseLease,
  leaseStatus,
  guardCommit
} from './core/lease.mjs';

export {
  addEvidence,
  listEvidence,
  verifyTaskEvidence,
  requirePassingEvidence
} from './core/evidence.mjs';

export {
  GATE_DEFS,
  ROLES,
  TASK_STATUSES,
  EVIDENCE_VERDICTS,
  PROTOCOL_VERSION,
  SCHEMA_VERSION
} from './core/constants.mjs';

export { makeCheck, summarize, hasBlocking, exitCodeFor } from './core/checks.mjs';

export { parseFrontMatter } from './core/frontmatter.mjs';

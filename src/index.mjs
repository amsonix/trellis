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
  verifyTask,
  evidenceFor,
  listProfiles
} from './core/project.mjs';

export {
  claimTask,
  addTask,
  reportTask,
  addTaskEvidence,
  askTask,
  answerTask,
  reindex,
  approveGate,
  waiveGate,
  acquireLease,
  releaseLease,
  addEvidence,
  retractEvidence,
  compact
} from './core/mutations.mjs';

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
  leaseStatus,
  guardCommit
} from './core/lease.mjs';

export {
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

export { A2A_STATES, mapTaskState, exportA2A } from './core/export-a2a.mjs';

export { parseFrontMatter } from './core/frontmatter.mjs';

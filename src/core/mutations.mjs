/**
 * Locked entry points for every command that mutates the ledger.
 *
 * The core modules stay pure and lock-free; this module is what the CLI, the
 * MCP server and the public package surface call. Each wrapper takes the
 * project root first, exactly like the function it wraps.
 */
import { withLock } from './lock.mjs';
import {
  claimTask as claimTaskUnlocked,
  reportTask as reportTaskUnlocked,
  addTask as addTaskUnlocked,
  askTask as askTaskUnlocked,
  answerTask as answerTaskUnlocked,
  addTaskEvidence as addTaskEvidenceUnlocked,
  reindex as reindexUnlocked,
  approveGate as approveGateUnlocked,
  waiveGate as waiveGateUnlocked
} from './project.mjs';
import { addEvidence as addEvidenceUnlocked, retractEvidence as retractEvidenceUnlocked } from './evidence.mjs';
import { acquireLease as acquireLeaseUnlocked, releaseLease as releaseLeaseUnlocked } from './lease.mjs';

const locked = (fn) => (root, ...args) => withLock(root, () => fn(root, ...args));

export const claimTask = locked(claimTaskUnlocked);
export const reportTask = locked(reportTaskUnlocked);
export const addTask = locked(addTaskUnlocked);
export const askTask = locked(askTaskUnlocked);
export const answerTask = locked(answerTaskUnlocked);
export const addTaskEvidence = locked(addTaskEvidenceUnlocked);
export const reindex = locked(reindexUnlocked);
export const approveGate = locked(approveGateUnlocked);
export const waiveGate = locked(waiveGateUnlocked);
export const retractEvidence = locked(retractEvidenceUnlocked);
export const releaseLease = locked(releaseLeaseUnlocked);
export const addEvidence = locked(addEvidenceUnlocked);
export const acquireLease = locked(acquireLeaseUnlocked);

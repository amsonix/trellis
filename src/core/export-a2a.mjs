/**
 * Read-only A2A view of the task board.
 *
 * Trellis keeps six statuses; A2A has a smaller task lifecycle. The mapping is
 * lossy on purpose — the Trellis status, scope and dependencies are preserved
 * under `metadata.trellis` so nothing is hidden by the projection.
 */
import { loadState } from './store.mjs';
import { parseTasks } from './tasks.mjs';
import { listEvidence } from './evidence.mjs';
import { nowIso } from './util.mjs';

export const A2A_STATES = {
  todo: 'submitted',
  ready: 'submitted',
  in_progress: 'working',
  review: 'working',
  blocked: 'input-required',
  done: 'completed',
  canceled: 'canceled'
};

export function mapTaskState(status) {
  return A2A_STATES[status] ?? 'submitted';
}

export async function exportA2A(root) {
  const state = await loadState(root);
  const { tasks } = await parseTasks(root);
  const byTask = new Map();
  for (const record of await listEvidence(root)) {
    if (!byTask.has(record.taskId)) byTask.set(record.taskId, []);
    byTask.get(record.taskId).push(record);
  }
  return {
    kind: 'a2a.tasks',
    version: 1,
    contextId: state.project.name,
    generatedAt: nowIso(),
    tasks: tasks.map((task) => ({
      id: task.id,
      contextId: state.project.name,
      status: { state: mapTaskState(task.status) },
      artifacts: (byTask.get(task.id) ?? []).map((record) => ({
        artifactId: record.id,
        name: record.uri,
        parts: [
          {
            kind: 'text',
            text: `${record.kind}: ${record.verdict}${record.retracted ? ' (retracted)' : ''}${record.note ? ` — ${record.note}` : ''}`
          }
        ]
      })),
      metadata: {
        trellis: {
          status: task.status,
          role: task.role,
          milestone: task.milestone,
          scope: task.scope,
          dependsOn: task.dependsOn,
          acceptance: task.acceptance,
          verification: task.verification
        }
      }
    }))
  };
}

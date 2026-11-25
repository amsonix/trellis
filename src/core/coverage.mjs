import { milestonesFromRoadmap, parseTasks } from './tasks.mjs';

const CLOSED = ['done', 'canceled'];

export function sourceMap(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const cache = new Map();
  const resolve = (task, seen = new Set()) => {
    if (!task || seen.has(task.id)) return null;
    if (cache.has(task.id)) return cache.get(task.id);
    seen.add(task.id);
    const own = task.source ?? null;
    const source = own || (task.parent ? resolve(byId.get(task.parent), seen) : null);
    cache.set(task.id, source);
    return source;
  };
  return new Map(tasks.map((task) => [task.id, resolve(task)]));
}

export function coverageFor(tasks, milestones) {
  const sources = sourceMap(tasks);
  const reports = milestones.map((milestone) => {
    const items = tasks.filter((task) => task.milestone === milestone.id);
    const sourceList = (task) => (sources.get(task.id) ?? '').split(',').filter(Boolean);
    const milestoneLevel = items.filter((task) => sourceList(task).includes(`ROADMAP#${milestone.id}`));
    const criteria = (milestone.criteria ?? []).map((criterion) => {
      const source = `ROADMAP#${milestone.id}/exit-${criterion.index}`;
      const covering = items.filter((task) => sourceList(task).includes(source)).map((task) => task.id);
      return {
        index: criterion.index,
        text: criterion.text,
        checked: criterion.checked,
        tasks: covering,
        covered: milestoneLevel.length > 0 || covering.length > 0
      };
    });
    return {
      id: milestone.id,
      title: milestone.title,
      declared: milestone.declared ?? 'planned',
      tasks: items.length,
      openTasks: items.filter((task) => !CLOSED.includes(task.status)).length,
      milestoneLevel: milestoneLevel.map((task) => task.id),
      criteria,
      uncovered: criteria.filter((criterion) => !criterion.covered).map((criterion) => criterion.index),
      orphans: items.filter((task) => !sources.get(task.id)).map((task) => task.id)
    };
  });
  const criteria = reports.flatMap((report) => report.criteria);
  return {
    milestones: reports,
    totals: {
      milestones: reports.length,
      criteria: criteria.length,
      covered: criteria.filter((criterion) => criterion.covered).length,
      uncovered: criteria.filter((criterion) => !criterion.covered).length,
      orphanTasks: tasks.filter((task) => !sources.get(task.id)).length
    },
    orphans: tasks.filter((task) => !sources.get(task.id)).map((task) => task.id)
  };
}

export async function planCoverage(root) {
  const { tasks } = await parseTasks(root);
  return coverageFor(tasks, await milestonesFromRoadmap(root));
}

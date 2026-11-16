import { milestonesFromRoadmap, parseTasks } from './tasks.mjs';

const CLOSED = ['done', 'canceled'];

export function coverageFor(tasks, milestones) {
  const reports = milestones.map((milestone) => {
    const items = tasks.filter((task) => task.milestone === milestone.id);
    const milestoneLevel = items.filter((task) => task.source === `ROADMAP#${milestone.id}`);
    const criteria = (milestone.criteria ?? []).map((criterion) => {
      const source = `ROADMAP#${milestone.id}/exit-${criterion.index}`;
      const covering = items.filter((task) => task.source === source).map((task) => task.id);
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
      orphans: items.filter((task) => !task.source).map((task) => task.id)
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
      orphanTasks: tasks.filter((task) => !task.source).length
    },
    orphans: tasks.filter((task) => !task.source).map((task) => task.id)
  };
}

export async function planCoverage(root) {
  const { tasks } = await parseTasks(root);
  return coverageFor(tasks, await milestonesFromRoadmap(root));
}

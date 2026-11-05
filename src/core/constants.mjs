export const PROTOCOL_VERSION = '0.9.13';
export const SCHEMA_VERSION = 3;
export const META_DIR = '.trellis';

export const STAGES = [
  'intake',
  'discovery',
  'architecture',
  'plan',
  'ready',
  'executing',
  'integrating',
  'releasing',
  'maintained'
];

export const PROJECT_GATES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G6', 'G7'];
export const ALL_GATES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];

export const GATE_DEFS = {
  G0: {
    id: 'G0',
    title: 'Scope',
    stage: 'intake',
    approvers: ['human'],
    artifacts: ['PROJECT'],
    summary: 'The problem, users, scope, non-goals, constraints and acceptance are explicit.'
  },
  G1: {
    id: 'G1',
    title: 'Research',
    stage: 'discovery',
    approvers: ['architect', 'human'],
    artifacts: ['RESEARCH'],
    summary: 'Prior art, unknowns and risks are written down and owned.'
  },
  G2: {
    id: 'G2',
    title: 'Architecture',
    stage: 'architecture',
    approvers: ['architect', 'human'],
    artifacts: ['ARCHITECTURE'],
    summary: 'Context, containers, components, data, interfaces, failure modes, security and deployment are described.'
  },
  G3: {
    id: 'G3',
    title: 'Plan',
    stage: 'plan',
    approvers: ['human'],
    artifacts: ['ROADMAP', 'TASKS', 'VERIFICATION'],
    summary: 'Every milestone has an exit criterion and every task has scope, acceptance and a verification method.'
  },
  G4: {
    id: 'G4',
    title: 'Ready',
    stage: 'ready',
    approvers: ['coordinator', 'human'],
    artifacts: [],
    summary: 'The task graph is acyclic, dependencies are satisfied, and concurrent tasks do not share a write domain.'
  },
  G5: {
    id: 'G5',
    title: 'Task review',
    stage: 'executing',
    approvers: ['reviewer'],
    artifacts: [],
    perTask: true,
    summary: 'A task is done only when its acceptance is backed by evidence.'
  },
  G6: {
    id: 'G6',
    title: 'Integration',
    stage: 'integrating',
    approvers: ['verifier', 'human'],
    artifacts: ['VERIFICATION'],
    summary: 'All tasks are done, their evidence verifies, and the integration checks pass.'
  },
  G7: {
    id: 'G7',
    title: 'Release',
    stage: 'releasing',
    approvers: ['human', 'operator'],
    artifacts: ['OPERATIONS'],
    summary: 'Deploy, rollback, monitoring and runbook are written down.'
  }
};

export const ROLES = [
  'human',
  'coordinator',
  'architect',
  'executor',
  'reviewer',
  'verifier',
  'operator'
];

export const TASK_PRIORITIES = ['high', 'medium', 'low'];
export const TASK_PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const TASK_STATUSES = [
  'todo',
  'ready',
  'in_progress',
  'review',
  'blocked',
  'done',
  'canceled'
];

export const TASK_TRANSITIONS = {
  todo: ['in_progress', 'blocked'],
  ready: ['in_progress', 'blocked'],
  in_progress: ['review', 'blocked', 'done', 'todo'],
  review: ['done', 'blocked', 'in_progress', 'todo'],
  blocked: ['in_progress', 'review', 'done'],
  done: ['in_progress', 'todo']
};

export const EVIDENCE_VERDICTS = ['pass', 'fail', 'inconclusive'];
export const EVIDENCE_KINDS = ['test', 'benchmark', 'review', 'approval', 'log', 'screenshot', 'doc'];

export const SEVERITIES = ['pass', 'warn', 'fail', 'unavailable'];

export const EXIT_CODES = {
  OK: 0,
  USAGE: 2,
  REFUSED: 3,
  UNAVAILABLE: 4
};

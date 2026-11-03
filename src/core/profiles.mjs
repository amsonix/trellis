import { UsageError } from './errors.mjs';

export const PROFILES = {
  'web-app': {
    id: 'web-app',
    title: 'Web application',
    description: 'A user-facing application with deployment and operations concerns.',
    requiredArtifacts: ['PROJECT', 'RESEARCH', 'ARCHITECTURE', 'ROADMAP', 'TASKS', 'VERIFICATION', 'OPERATIONS'],
    optionalArtifacts: ['GLOSSARY', 'INVARIANTS'],
    gates: ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']
  },
  library: {
    id: 'library',
    title: 'Library or SDK',
    description: 'A reusable package with an API, compatibility and release concerns.',
    requiredArtifacts: ['PROJECT', 'RESEARCH', 'ARCHITECTURE', 'ROADMAP', 'TASKS', 'VERIFICATION'],
    optionalArtifacts: ['OPERATIONS', 'GLOSSARY', 'INVARIANTS'],
    gates: ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']
  },
  cli: {
    id: 'cli',
    title: 'Command-line tool',
    description: 'A developer-facing tool with UX, compatibility and release concerns.',
    requiredArtifacts: ['PROJECT', 'RESEARCH', 'ARCHITECTURE', 'ROADMAP', 'TASKS', 'VERIFICATION'],
    optionalArtifacts: ['OPERATIONS', 'GLOSSARY', 'INVARIANTS'],
    gates: ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']
  }
};

export function getProfile(id) {
  const profile = PROFILES[id];
  if (!profile) {
    throw new UsageError(`unknown profile '${id}' (choose: ${Object.keys(PROFILES).join(', ')})`);
  }
  return profile;
}

export function listProfiles() {
  return Object.values(PROFILES).map(({ id, title, description, requiredArtifacts }) => ({
    id,
    title,
    description,
    requiredArtifacts
  }));
}

import path from 'node:path';
import { makeCheck } from './checks.mjs';
import { parseFrontMatter } from './frontmatter.mjs';
import {
  exists,
  readText,
  splitSections,
  getSection,
  parseMarkdownTable,
  hasListItem,
  hasMermaid,
  listDir
} from './util.mjs';

export const ARTIFACTS = {
  PROJECT: {
    id: 'PROJECT',
    title: 'Project brief',
    path: 'PROJECT.md',
    stage: 'intake',
    requiredSections: ['Problem', 'Users', 'Scope', 'Non-goals', 'Constraints', 'Acceptance']
  },
  RESEARCH: {
    id: 'RESEARCH',
    title: 'Research',
    path: 'docs/RESEARCH.md',
    stage: 'discovery',
    requiredSections: ['Questions', 'Prior art', 'Unknowns', 'Risks']
  },
  ARCHITECTURE: {
    id: 'ARCHITECTURE',
    title: 'Architecture',
    path: 'docs/ARCHITECTURE.md',
    stage: 'architecture',
    requiredSections: [
      'Context',
      'Containers',
      'Components',
      'Data model',
      'Interfaces',
      'Failure modes',
      'Security',
      'Deployment',
      'Observability',
      'Open questions'
    ]
  },
  ROADMAP: {
    id: 'ROADMAP',
    title: 'Roadmap',
    path: 'docs/ROADMAP.md',
    stage: 'plan',
    requiredSections: []
  },
  TASKS: {
    id: 'TASKS',
    title: 'Task board',
    path: 'docs/TASKS.md',
    stage: 'plan',
    requiredSections: []
  },
  VERIFICATION: {
    id: 'VERIFICATION',
    title: 'Verification plan',
    path: 'docs/VERIFICATION.md',
    stage: 'plan',
    requiredSections: ['Strategy', 'Oracle', 'Fixtures', 'Evidence']
  },
  OPERATIONS: {
    id: 'OPERATIONS',
    title: 'Operations',
    path: 'docs/OPERATIONS.md',
    stage: 'releasing',
    requiredSections: ['Deploy', 'Rollback', 'Monitoring', 'Runbook']
  },
  GLOSSARY: {
    id: 'GLOSSARY',
    title: 'Glossary',
    path: 'docs/GLOSSARY.md',
    stage: 'architecture',
    requiredSections: ['Terms']
  },
  INVARIANTS: {
    id: 'INVARIANTS',
    title: 'Invariants',
    path: 'docs/INVARIANTS.md',
    stage: 'architecture',
    requiredSections: ['Invariants']
  }
};

export async function readArtifact(root, id) {
  const definition = ARTIFACTS[id];
  if (!definition) return { definition, missing: true, error: 'UNKNOWN_ARTIFACT' };
  const file = path.join(root, definition.path);
  if (!(await exists(file))) {
    return { definition, file, missing: true, error: null };
  }
  const text = await readText(file);
  const frontMatter = parseFrontMatter(text);
  const sections = splitSections(frontMatter.body);
  return {
    definition,
    file,
    text,
    data: frontMatter.data,
    body: frontMatter.body,
    sections,
    missing: false,
    error: frontMatter.error
  };
}

async function adrFiles(root) {
  const dir = path.join(root, 'docs/adr');
  const entries = await listDir(dir);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => path.join(dir, entry.name));
}

function tableHeaders(section) {
  if (!section) return null;
  const table = parseMarkdownTable(section.content);
  return table ? table.headers : null;
}

function hasHeader(headers, name) {
  return headers?.some((header) => header.toLowerCase().replace(/\s+/g, '') === name.toLowerCase().replace(/\s+/g, ''));
}

export async function checkArtifact(root, id, profile) {
  const definition = ARTIFACTS[id];
  const checks = [];
  if (!definition) {
    checks.push(makeCheck('ARTIFACT_UNKNOWN', 'fail', `unknown artifact '${id}'`, { artifact: id }));
    return checks;
  }
  const required = profile.requiredArtifacts.includes(id);
  const optional = profile.optionalArtifacts.includes(id);
  if (!required && !optional) return checks;

  const artifact = await readArtifact(root, id);
  if (artifact.missing) {
    checks.push(
      makeCheck(
        'ARTIFACT_MISSING',
        required ? 'fail' : 'warn',
        `${definition.path} is missing${required ? '' : ' (optional)'}`,
        { artifact: id, path: definition.path, stage: definition.stage }
      )
    );
    return checks;
  }

  if (artifact.error === 'missing') {
    checks.push(
      makeCheck('FRONTMATTER_MISSING', 'fail', `${definition.path} has no YAML front-matter`, {
        artifact: id,
        path: definition.path,
        stage: definition.stage
      })
    );
  } else if (artifact.error) {
    checks.push(
      makeCheck('FRONTMATTER_INVALID', 'fail', `${definition.path} has invalid front-matter (${artifact.error})`, {
        artifact: id,
        path: definition.path,
        stage: definition.stage
      })
    );
  } else if (artifact.data.id && artifact.data.id !== id) {
    checks.push(
      makeCheck('FRONTMATTER_ID_MISMATCH', 'warn', `${definition.path} says id=${artifact.data.id}, expected ${id}`, {
        artifact: id,
        path: definition.path,
        stage: definition.stage
      })
    );
  }

  if (definition.requiredSections.length > 0) {
    for (const sectionName of definition.requiredSections) {
      const section = getSection(artifact.sections, sectionName);
      if (!section) {
        checks.push(
          makeCheck('SECTION_MISSING', 'fail', `${definition.path} is missing section "## ${sectionName}"`, {
            artifact: id,
            path: definition.path,
            stage: definition.stage,
            section: sectionName
          })
        );
      } else if (!section.content.trim()) {
        checks.push(
          makeCheck('SECTION_EMPTY', 'fail', `${definition.path} section "## ${sectionName}" is empty`, {
            artifact: id,
            path: definition.path,
            stage: definition.stage,
            section: sectionName
          })
        );
      }
    }
  }

  if (id === 'PROJECT') {
    const acceptance = getSection(artifact.sections, 'Acceptance');
    if (acceptance && !hasListItem(acceptance.content)) {
      checks.push(
        makeCheck('ACCEPTANCE_EMPTY', 'fail', 'PROJECT.md Acceptance must contain at least one checklist item', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    }
  }

  if (id === 'ARCHITECTURE') {
    const containers = getSection(artifact.sections, 'Containers');
    const headers = tableHeaders(containers);
    if (!headers) {
      checks.push(
        makeCheck('CONTAINERS_TABLE_MISSING', 'fail', 'ARCHITECTURE.md Containers must contain a Markdown table', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    } else {
      for (const requiredHeader of ['Container', 'Responsibility', 'Interface']) {
        if (!hasHeader(headers, requiredHeader)) {
          checks.push(
            makeCheck('CONTAINERS_TABLE_INVALID', 'fail', `ARCHITECTURE.md Containers table needs a "${requiredHeader}" column`, {
              artifact: id,
              path: definition.path,
              stage: definition.stage
            })
          );
        }
      }
    }
    if (!hasMermaid(artifact.text)) {
      checks.push(
        makeCheck('MERMAID_MISSING', 'warn', 'ARCHITECTURE.md has no Mermaid diagram', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    }
    const adrs = await adrFiles(root);
    if (adrs.length === 0) {
      checks.push(
        makeCheck('ADR_MISSING', 'warn', 'docs/adr/ has no ADR; record at least the first key decision', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    }
  }

  if (id === 'ROADMAP') {
    const milestones = artifact.sections.filter((section) => /^m\d+\b/.test(section.key));
    if (milestones.length === 0) {
      checks.push(
        makeCheck('MILESTONE_MISSING', 'fail', 'ROADMAP.md must contain at least one "## M..." milestone', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    }
    for (const milestone of milestones) {
      if (!/exit criteria/i.test(milestone.content)) {
        checks.push(
          makeCheck('MILESTONE_EXIT_MISSING', 'fail', `milestone "${milestone.title}" has no "Exit criteria"`, {
            artifact: id,
            path: definition.path,
            stage: definition.stage,
            section: milestone.title
          })
        );
      }
    }
  }

  if (id === 'TASKS') {
    const table = parseMarkdownTable(artifact.body);
    if (!table) {
      checks.push(
        makeCheck('TASKS_TABLE_MISSING', 'fail', 'TASKS.md has no Markdown task table', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    } else if (table.rows.length === 0) {
      checks.push(
        makeCheck('TASKS_EMPTY', 'fail', 'TASKS.md task table has no rows', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    }
  }

  if (id === 'VERIFICATION') {
    const evidence = getSection(artifact.sections, 'Evidence');
    if (evidence && !evidence.content.trim()) {
      checks.push(
        makeCheck('EVIDENCE_PLAN_EMPTY', 'fail', 'VERIFICATION.md Evidence must say how evidence is produced', {
          artifact: id,
          path: definition.path,
          stage: definition.stage
        })
      );
    }
  }

  if (!checks.some((check) => check.severity === 'fail' || check.severity === 'unavailable')) {
    checks.push(
      makeCheck('ARTIFACT_OK', 'pass', `${definition.path} is structurally valid`, {
        artifact: id,
        path: definition.path,
        stage: definition.stage
      })
    );
  }
  return checks;
}

export async function checkAllArtifacts(root, profile) {
  const checks = [];
  for (const id of [...profile.requiredArtifacts, ...profile.optionalArtifacts]) {
    checks.push(...(await checkArtifact(root, id, profile)));
  }
  return checks;
}

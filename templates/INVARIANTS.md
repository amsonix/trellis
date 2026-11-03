---
id: INVARIANTS
project: {{PROJECT_NAME}}
stage: architecture
status: draft
owners: [architect]
version: 1
created: {{DATE}}
---

# Invariants

## Invariants

- No task is marked done without passing evidence.
- No two concurrent tasks share a write domain.
- A gate cannot be approved by the role that produced the work.
- The source of truth is in git; `.project-protocol/` is an index.

---
id: TASKS
project: {{PROJECT_NAME}}
stage: plan
status: draft
owners: [coordinator]
version: 1
created: {{DATE}}
---

# Tasks

One row per unit of work. `Scope` is a comma-separated list of path prefixes the
task may write. `Depends on` is a comma-separated list of task ids, or `-`.
`Acceptance` says what must be true; `Verification` says how it is checked.

| ID | Milestone | Title | Role | Scope | Depends on | Acceptance | Verification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-001 | M0 | Bootstrap the project | executor | src, test, package.json, README.md | - | Build, test, and lint pass | `npm test` and CI | todo |

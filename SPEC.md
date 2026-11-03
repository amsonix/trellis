# Trellis — Specification

**Status:** draft, version 0.1.0.
**Scope:** a normative protocol for an agent (or a team of agents and humans) to
build a project: stages, artifacts, gates, roles, tasks and evidence.

This document is the contract. The reference implementation is in `src/`; the
JSON Schemas in `schema/` are the machine-readable subset. Where the code and
this document disagree, this document is the intent and the code is a bug —
unless the section **Implementation status** says a rule is not implemented yet.

---

## 1. Purpose

An agent can write code. The hard part is knowing **what to build, in which
order, with what proof, and when to stop and ask a person**. The protocol makes
those questions explicit and checkable.

It answers five questions at every moment:

| Question | Answer |
|---|---|
| Where am I? | `Project.stage` |
| What must exist now? | `Profile.requiredArtifacts[stage]` |
| What does done mean? | `Acceptance` + `Verification` + `Evidence` + `Gate` |
| What may I write? | `Role` + `Task.scope` + `Mandate` |
| What next, and who approves? | `project next` + `Gate.approvers` |

## 2. Non-goals

- Replacing code review, CI or a human product decision.
- Scheduling arbitrary DAGs across machines.
- Generating architecture content or prose. The protocol checks structure; a
  model or a person writes the content.
- Being a security boundary. A local file can be edited by hand; the guards make
  the default path safe, not impossible to bypass.

## 3. Source of truth

1. **The fixed management directory `<project>/.trellis/` holds the
   artifacts.** `PROJECT.md`, `docs/*.md` and `docs/adr/*.md` inside it are the
   source of truth and are committed with the project.
2. **The same directory holds the ledger.** `state.json`, `evidence.json` and
   `leases.json` record gates, evidence, leases and history. The ledger can be
   rebuilt with `reindex` when the artifacts are intact.
3. **A task is a row in `.trellis/docs/TASKS.md`.** A lease is a
   separate record that names the task, the actor and the write domains.
4. **A gate is an approval event**, not a file. It is recorded in the state
   ledger with the approver, time and note.
5. **`init` may run on an existing project.** It creates `.trellis/` and,
   when absent, the agent skill `.agents/skills/trellis/SKILL.md`. It never
   overwrites an existing file — including `README.md`, `TASKS.md` and
   `docs/` — and refuses a non-empty `.trellis/`.

## 4. Stages

```text
intake → discovery → architecture → plan → ready → executing → integrating → releasing → maintained
```

The stage is derived, not stored as an independent field:

- `G7` satisfied → `maintained`
- `G6` satisfied → `releasing`
- `G4` satisfied and every task is `done` → `integrating`
- `G4` satisfied → `executing`
- otherwise the stage of the first unsatisfied gate in `G0..G4`

`G5` is a per-task gate and does not define a project stage.

## 5. Gates

| Gate | Stage | Approvers | Required artifacts | Blocking conditions |
|---|---|---|---|---|
| `G0` Scope | intake | human | `PROJECT` | missing/empty required sections; no acceptance item |
| `G1` Research | discovery | architect, human | `RESEARCH` | missing/empty required sections |
| `G2` Architecture | architecture | architect, human | `ARCHITECTURE` | missing/empty sections; no containers table with `Container`, `Responsibility`, `Interface` |
| `G3` Plan | plan | human | `ROADMAP`, `TASKS`, `VERIFICATION` | missing milestone exit criteria; no task table; missing verification sections |
| `G4` Ready | ready | coordinator, human | — | empty task table; invalid role/status/scope/acceptance/verification; unknown dependency; cycle; concurrent tasks sharing a write domain |
| `G5` Task review | executing | reviewer | — | task not `review`/`done`; no passing evidence; failing evidence; inconclusive evidence is not a pass |
| `G6` Integration | integrating | verifier, human | `VERIFICATION` | any task not `done`; any task without passing evidence |
| `G7` Release | releasing | human, operator | `OPERATIONS` (when the profile requires it) | missing/empty deploy/rollback/monitoring/runbook sections |

Rules:

1. A project gate cannot be approved before its predecessor in
   `G0, G1, G2, G3, G4, G6, G7`. `G5` is per task and independent.
2. The approver's role must be in the gate's `approvers`.
3. A gate with a blocking check is refused; the checks are returned in the
   error details.
4. Only a human may **waive** a gate, with a written reason. A waiver is
   recorded and is visible in `status`.
5. A gate cannot be approved twice.

## 6. Artifacts

Every artifact starts with YAML front-matter:

```yaml
---
id: ARCHITECTURE
project: my-project
stage: architecture
status: draft | review | approved
owners: [architect]
version: 1
created: 2026-11-03
---
```

Then a Markdown body with level-2 sections. The required sections are:

| Artifact | Path | Required sections |
|---|---|---|
| `PROJECT` | `.trellis/PROJECT.md` | Problem, Users, Scope, Non-goals, Constraints, Acceptance |
| `RESEARCH` | `.trellis/docs/RESEARCH.md` | Questions, Prior art, Unknowns, Risks |
| `ARCHITECTURE` | `.trellis/docs/ARCHITECTURE.md` | Context, Containers, Components, Data model, Interfaces, Failure modes, Security, Deployment, Observability, Open questions |
| `ROADMAP` | `.trellis/docs/ROADMAP.md` | at least one `## M...` milestone, each with `Exit criteria` |
| `TASKS` | `.trellis/docs/TASKS.md` | a task table (see §7) |
| `VERIFICATION` | `.trellis/docs/VERIFICATION.md` | Strategy, Oracle, Fixtures, Evidence |
| `OPERATIONS` | `.trellis/docs/OPERATIONS.md` | Deploy, Rollback, Monitoring, Runbook |
| `GLOSSARY` | `.trellis/docs/GLOSSARY.md` | Terms |
| `INVARIANTS` | `.trellis/docs/INVARIANTS.md` | Invariants |

Special checks:

- `PROJECT.Acceptance` contains at least one list item.
- `ARCHITECTURE.Context` contains at least one Mermaid block (warning if not).
- `ARCHITECTURE.Containers` contains a Markdown table with `Container`,
  `Responsibility` and `Interface` columns.
- `.trellis/docs/adr/` contains at least one ADR (warning if not).
- A rendered diagram or a link that does not resolve is a warning, not a
  failure, until a renderer/link checker is wired in.

## 7. Tasks

`.trellis/docs/TASKS.md` contains exactly one task table with this header:

```text
| ID | Milestone | Title | Role | Scope | Depends on | Acceptance | Verification | Status |
```

Rules:

1. `ID` is unique and should look like `T-001`.
2. `Milestone` must match a `## M...` section in `ROADMAP.md`.
3. `Role` is one of `human`, `coordinator`, `architect`, `executor`, `reviewer`,
   `verifier`, `operator`.
4. `Status` is one of `todo`, `ready`, `in_progress`, `review`, `blocked`,
   `done`.
5. `Scope` is a comma-separated list of path prefixes. A path is in scope when
   it equals a prefix or starts with `prefix/`. `-` is not allowed.
6. `Depends on` is a comma-separated list of task IDs, or `-`.
7. `Acceptance` says what must be true. `Verification` says how it is checked.
8. The dependency graph must be acyclic.
9. Two tasks that may run concurrently (`todo`, `ready` or `in_progress`) must
   not share a write domain unless one depends on the other. Add a dependency
   or narrow the scope.
10. `done` requires at least one `pass` evidence item for the task and no
    `fail` evidence. `inconclusive` is not a pass.

Allowed status transitions:

```text
todo        → in_progress | blocked
ready       → in_progress | blocked
in_progress → review | blocked | done
review      → done | blocked
blocked    → in_progress | review | done
done        → (terminal)
```

`task claim` sets `in_progress` and acquires a lease over the task's scope.
`task report --state done` verifies evidence and releases the lease.

## 8. Evidence

```json
{
  "id": "EV-...",
  "taskId": "T-001",
  "kind": "test | benchmark | review | approval | log | screenshot | doc",
  "uri": "relative/path | https://... | commit-sha",
  "sha256": "optional, computed for an existing local file",
  "verdict": "pass | fail | inconclusive",
  "producedBy": "verifier:ci",
  "producedAt": "2026-11-03T...",
  "note": "optional"
}
```

Rules:

- Evidence is stored in `.trellis/evidence.json`.
- A local file URI gets a sha256 at add time; a changed file needs new evidence.
- A task cannot be `done` without a `pass` and with any `fail`.
- A gate cannot be approved on a task whose evidence does not verify.
- Evidence is not a claim in a report; it is a checkable record.

## 9. Roles

| Role | May write | May approve | May not |
|---|---|---|---|
| Human | constitution, scope, gates | `G0`, `G1`, `G2`, `G3`, `G4`, `G6`, `G7`, waivers | — |
| Coordinator | project state, task graph | `G4` | product code |
| Architect | architecture, ADRs, roadmap | `G1`, `G2` | product code |
| Executor | code/tests inside a task's scope | — | approve its own gate; edit architecture |
| Reviewer | review comments | `G5` | change the code under review |
| Verifier | evidence | `G5`, `G6` | change the code under test |
| Operator | operations, deploy | `G7` | change product code |

The reference implementation enforces:

- gate approver roles;
- task claim role;
- task status transitions;
- write scope at `task claim` and `guard commit`.

It does **not** yet enforce file-level writes on disk. The guard is a
commit-time check; a writer can still edit a file by hand. That is a known
boundary, not a claim of sandboxing.

## 10. Commands and exit codes

The CLI is the reference integration surface. The JSON envelope is:

```json
{ "ok": true, "command": "status", "data": {} }
{ "ok": false, "command": "gate", "error": { "code": "...", "message": "...", "details": {} } }
```

Exit codes:

| Code | Meaning |
|---|---|
| `0` | success; checks pass; gate approved |
| `2` | usage error |
| `3` | refused; checks fail; gate blocked; evidence missing |
| `4` | unavailable; state missing, unreadable artifact, git failure |

`status` and `check` never write. `gate`, `task`, `evidence`, `lease` and
`reindex` write the ledger and append an audit entry.

## 11. Checks and severity

Every check returns one of:

- `pass` — the rule holds;
- `warn` — the rule is useful but not blocking for this gate;
- `fail` — the gate/command is refused;
- `unavailable` — the state could not be read; **never** treated as a pass.

A check that cannot fail is not a check. The test suite includes negative
controls for each blocking rule.

## 12. Leases (execution constraint)

A lease is a held claim over write domains, recorded in
`.trellis/leases.json`.

- `task claim` acquires a lease over the task's scope; a conflicting lease
  refuses the claim.
- `task report --state done` releases the lease.
- `lease release <T-NNN> --by <role>:<name>` releases a held lease without
  completing the task — the recovery path when a task is abandoned or blocked.
  The record keeps `releasedAt` and `releasedBy`; releasing a lease nobody
  holds is refused.
- `guard commit --task <id> --staged` reads `git diff --cached --name-only` and
  refuses a staged path that is outside the task's scope or covered by another
  task's held lease.
- `--observe` reports `WOULD-BLOCK` and exits 0; use it before turning the guard
  into a real block.
- The lease is advisory to writers who do not run the guard. It is not a kernel
  lock and not a security boundary.

The measurement guard (shared `target/`, renderer identity) is **not**
implemented in this version. It is the next execution-constraint module.

## 13. Profiles

A profile selects required/optional artifacts and the gates that apply.

`--profile` is optional; the default is `generic`.

| Profile | Required artifacts | Optional |
|---|---|---|
| `generic` | `PROJECT`, `ARCHITECTURE`, `ROADMAP`, `TASKS`, `VERIFICATION` | `RESEARCH`, `OPERATIONS`, `GLOSSARY`, `INVARIANTS` |
| `web-app` | `PROJECT`, `RESEARCH`, `ARCHITECTURE`, `ROADMAP`, `TASKS`, `VERIFICATION`, `OPERATIONS` | `GLOSSARY`, `INVARIANTS` |
| `library` | `PROJECT`, `RESEARCH`, `ARCHITECTURE`, `ROADMAP`, `TASKS`, `VERIFICATION` | `OPERATIONS`, `GLOSSARY`, `INVARIANTS` |
| `cli` | same as `library` | `OPERATIONS`, `GLOSSARY`, `INVARIANTS` |

A profile is data, not code. Add a profile by adding an entry in
`src/core/profiles.mjs`; add a template only when the profile needs a new
artifact.

## 14. Invariants

1. Files are the source of truth; the ledger is an index.
2. No task is `done` without passing evidence.
3. No gate is approved by a role that produced the work.
4. No two concurrent tasks share a write domain without a dependency.
5. A gate cannot be approved out of order.
6. `unavailable` is never a pass.
7. Every write command appends an audit entry.
8. `check` and `status` do not mutate the project.

## 15. Implementation status

Implemented in `0.1.0`:

- `init` on a new or existing project; it creates a fixed
  `<project>/.trellis/`, writes the agent skill once, and never overwrites
  existing files;
- `generic` (default), `web-app`, `library` and `cli` profiles;
- artifact existence, front-matter, required-section and special checks;
- task table parsing, graph validation, scope-overlap check, status transitions;
- gates `G0`–`G7`, approver roles, order, waivers, per-task `G5`;
- evidence ledger, passing/failing/inconclusive verification;
- leases on task claim, release, conflict detection, `guard commit --staged`
  with `--observe`;
- `status`, `check`, `next`, `reindex`, JSON envelope, exit codes;
- 38 `node:test` cases.

Not in `0.1.0`:

- measurement guard (shared target / renderer identity);
- file-level write enforcement (only commit-time guard);
- DSH / Super-agent plugin or tool surface;
- SQLite store, HTTP server, multi-user/multi-host;
- policy versioning and revalidation of live leases;
- diagram rendering and link checking;
- automatic task generation from a roadmap.

## 16. Versioning

- `PROTOCOL_VERSION` in `src/core/constants.mjs`.
- `SCHEMA_VERSION` in the state ledger; a newer schema refuses to load.
- `--json` output is a contract; additive fields are allowed in a minor version,
  removals/renames need a major version.
- Templates are versioned with the package; a project keeps its own copies, so
  upgrading the package does not rewrite a project.

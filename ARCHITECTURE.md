# Trellis architecture

Trellis is a **file-based control protocol** for planning and executing work.
It does not run agents, schedule processes or store a second copy of state.
This document is the canonical map; `SPEC.md` is the normative rulebook and the
CLI/MCP are interfaces over it.

## 1. Four planes

```text
CONTROL PLANE        what is approved, and what must be written
  PROJECT -> RESEARCH -> ARCHITECTURE + ADR -> ROADMAP/VERIFICATION -> OPERATIONS
  each layer is an artifact; a gate is the approval event

PLANNING PLANE       what work exists and why
  ROADMAP milestone -> exit criteria -> TASKS -> Source coverage

EXECUTION PLANE      who is doing what, and what proves it
  claim/lease -> work -> checkpoint/evidence -> report -> G5 review

INTERFACE PLANE      how humans and agents see or change the above
  CLI, MCP, skill, status panel, JSON envelope
```

The planes are ordered, not layered abstractions: the control plane authorizes
the planning plane, and the planning plane authorizes execution.

## 2. Canonical objects

| Object | Lives in | Owns | Does not own |
|---|---|---|---|
| Artifact | `.trellis/PROJECT.md`, `.trellis/docs/*.md` | content, front-matter, sections | approval state |
| Gate | `state.json` | approval/waiver, approver, digest | artifact content |
| ADR | `.trellis/docs/adr/*.md` | one decision and its status | architecture prose |
| Milestone | `ROADMAP.md` section | goal, exit criteria, declared status | task execution |
| Task | one row in `TASKS.md` | scope, acceptance, verification, relations | evidence |
| Lease | `leases.json` | write-domain lock for a task | task status |
| Evidence | `evidence/T-*.jsonl` | checkable proof or checkpoint | task status |
| Question | `state.json` | one blocking human decision | task status |
| State | `state.json` | gates, questions, leases, audit | task rows, evidence |

## 3. Document hierarchy

```text
G0  PROJECT            scope, non-goals, acceptance
G1  RESEARCH           questions, prior art, unknowns, risks   (optional; waivable)
G2  ARCHITECTURE       context, containers, interfaces, failure, security
    ADR                decisions under architecture
G3  ROADMAP            milestones + exit criteria
    VERIFICATION       strategy, oracle, fixtures, evidence
    TASKS              work units traced to ROADMAP
G4  (no new artifact)  graph + concurrency check
G5  (per task)         review of evidence
G6  TASKS + VERIFICATION
G7  OPERATIONS         deploy, rollback, monitoring, runbook
```

`GLOSSARY.md` and `INVARIANTS.md` are optional architecture-stage references;
they have no gate. `README.md` is not a managed artifact.

Hard links, and only these:

1. `TASKS.milestone` -> a `## M...` section in ROADMAP.
2. `TASKS.source` -> `ARTIFACT#section` or `ROADMAP#M2/exit-1`.
3. `TASKS.parent` -> another task (containment).

Everything else is prose or a gate dependency, not a machine link.

## 4. Task graph

There are three relations. Do not add a fourth.

| Relation | Meaning | Closure rule |
|---|---|---|
| `dependsOn` | ordering: this task waits for another | both can be open |
| `parent` | containment: this task is part of another | parent cannot close before children |
| `source` | traceability: this task covers a document clause | coverage resolves through ancestors |

`followUpOf` is a **legacy alias** for `dependsOn` plus scope containment. New
work uses `--parent` for decomposition and `--depends-on` for ordering.

A task is one of:

```text
todo -> ready -> in_progress -> review -> done
                    |  ^
                    v  |
                  blocked
done/canceled are terminal for normal flow; reopening is an audited human or
coordinator action.
```

`checkpoint` is evidence, not a task state. It records "done so far / next" and
never satisfies `done`.

## 5. Evidence and leases

```text
proof evidence       pass/fail/review/...  -> can satisfy or block done
checkpoint evidence  inconclusive          -> progress only
```

A lease is a write-domain lock, not a scheduling promise. A parent with open
children cannot be claimed; a task with another actor's lease cannot be blocked
by a third party. A dead holder is recovered by a human (`lease reap`), never by
an automatic TTL.

## 6. Files and ownership

```text
.trellis/
  PROJECT.md              control
  docs/                   control + plan artifacts
    adr/*.md
  TASKS.md                planning
  evidence/T-*.jsonl      execution (append-only)
  leases.json             execution
  state.json              gates, questions, audit
  logs/                   task finish output
  worktrees/              host convention only; Trellis does not manage it
```

`TASKS.md`, artifacts and evidence are source of truth. `state.json` is the
ledger for approval and coordination. Do not duplicate either into a database.

## 7. Command surface

| Plane | Commands |
|---|---|
| Control | `doc list/show/check/scaffold`, `adr ...`, `gate`, `milestone ...` |
| Planning | `task add/edit/derive`, `plan coverage`, `next` |
| Execution | `task claim/checkpoint/finish/report/ask/answer/recover/cancel`, `evidence ...`, `lease ...` |
| Interface | `status [--panel] [--json]`, `report`, `brief`, `check` |

Views are not sources:

- `status` / `status --panel`: current snapshot.
- `report`: gate/task gaps and milestone roll-up.
- `next`: the only candidate set for an agent.
- `task list`: inventory, never a selection input.

Do not add a new command when an existing view can express the same data.

## 8. Agent loop

```text
session start
  -> brief (read set, gate, role)
  -> next (one candidate set)
  -> claim
  -> work
  -> checkpoint if stopping mid-task
  -> evidence + report done (or ask/block)
  -> G5 review
  -> next again
```

Gate approval is human-only at the CLI; MCP does not expose it. An agent must
stop at a gate and ask for approval, not self-approve.

## 9. Invariants

1. `.trellis/` is the only management directory.
2. No gate can be approved out of order; a stale earlier gate blocks later ones.
3. No actor approves a gate for work it produced.
4. A task cannot be `done` without passing evidence and no failing evidence.
5. A task's scope must be claimed before it is written.
6. A parent cannot close with open children.
7. A checkpoint never turns into proof.
8. Structural artifact edits stale the gate; prose-only edits drift it.
9. `source` is optional, but coverage treats an unsourced task as an orphan.
10. A gated task board accepts no tasks before G2.

## 10. Deliberate non-goals

- No agent runtime, scheduler or auto-continuation.
- No automatic task generation from documents.
- No automatic worktree creation/removal.
- No web dashboard or multi-tenant service.
- No file-level write enforcement; leases are cooperative.
- No second database or event store.

## 11. Current cleanup backlog

The current behavior is intentional; the structure is what needs tidying.

1. Split `src/core/project.mjs` (1987 lines) into:
   `status.mjs`, `next.mjs`, `report.mjs`, `task-ops.mjs`, and a thin
   `project.mjs` facade. No behavior change in the first pass.
2. Retire `followUpOf` from new documentation and tests; keep reading old rows
   for compatibility.
3. Keep one status renderer (`status --panel`), one gap report (`report`), one
   candidate engine (`next`). Do not add overlapping views.
4. Keep `checkpoint` as the only progress record; do not add a second WIP file.
5. Keep exactly three task relations and three document hard links above.


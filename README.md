# project-protocol

**An agent-facing protocol for building projects.**

It does not teach an agent how to write code. It tells an agent, at every step:

1. **Which stage is this project in?**
2. **Which artifact must exist now?**
3. **What does "done" mean, and what evidence proves it?**
4. **Which paths may this role write?**
5. **What is the next action, and who must approve it?**

The protocol is a small, dependency-free Node.js library and CLI. It stores
everything in one fixed directory inside the project:

```text
<project>/.project-protocol/
```

The Markdown artifacts there are the source of truth; `state.json`,
`evidence.json` and `leases.json` are the ledger. `init` can run on an existing
project: it creates `.project-protocol/` and never touches `README.md`,
`TASKS.md`, `docs/` or any other existing file.

```text
intake → discovery → architecture → plan → ready → executing → integrating → releasing → maintained
```

---

## Quickstart

Requires Node.js 20 or newer. There are no runtime dependencies.

```bash
cd project-protocol
npm test

# Create the management directory of a project (new or existing)
node bin/project-protocol.mjs init /tmp/demo

# Optional: choose a profile or a display name
node bin/project-protocol.mjs init /tmp/demo --profile web-app --name demo

# Inspect it
node bin/project-protocol.mjs status --dir /tmp/demo
node bin/project-protocol.mjs check --dir /tmp/demo
node bin/project-protocol.mjs next --dir /tmp/demo --role architect

# Approve the first gate (a human does this, not the executor)
node bin/project-protocol.mjs gate G0 --approve --by human:alice --dir /tmp/demo
```

Or install the binary locally:

```bash
npm link
project-protocol --help
```

---

## What it creates

```text
<project>/.project-protocol/
  PROJECT.md                   problem, users, scope, non-goals, constraints, acceptance
  README.md                    quickstart for the protocol root
  docs/RESEARCH.md             questions, prior art, unknowns, risks
  docs/ARCHITECTURE.md         context, containers, components, data, interfaces, failure,
                               security, deployment, observability, open questions
  docs/ROADMAP.md              milestones, each with exit criteria
  docs/TASKS.md                task table: scope, dependencies, acceptance, verification
  docs/VERIFICATION.md         strategy, oracle, fixtures, evidence
  docs/OPERATIONS.md           deploy, rollback, monitoring, runbook
  docs/GLOSSARY.md             terms
  docs/INVARIANTS.md           things that must never break
  docs/adr/0001-....md         the first architecture decision
  state.json                   gate ledger and audit
  evidence.json                evidence ledger
  leases.json                  write leases (the execution constraint)
```

A profile selects which artifacts are required. It is **optional**; the default
is `generic`.

| Profile | Use | Required artifacts |
|---|---|---|
| `generic` | any project (default) | `PROJECT`, `ARCHITECTURE`, `ROADMAP`, `TASKS`, `VERIFICATION` |
| `web-app` | user-facing application | all of the above plus `OPERATIONS` and `RESEARCH` |
| `library` | reusable package / SDK | core five plus `RESEARCH`; `OPERATIONS` optional |
| `cli` | command-line tool | core five plus `RESEARCH`; `OPERATIONS` optional |

`--name` is also optional; it defaults to the project directory name.

---

## The lifecycle

| Gate | Stage | Approver | What it means |
|---|---|---|---|
| **G0 Scope** | intake | human | Problem, users, scope, non-goals, constraints and acceptance are explicit |
| **G1 Research** | discovery | architect, human | Prior art, unknowns and risks are written down and owned |
| **G2 Architecture** | architecture | architect, human | Context, containers, components, data, interfaces, failure, security, deployment, observability |
| **G3 Plan** | plan | human | Every milestone has an exit criterion; every task has acceptance and verification |
| **G4 Ready** | ready | coordinator, human | The task graph is acyclic; concurrent tasks do not share a write domain |
| **G5 Task review** | executing | reviewer | A task is done only when passing evidence backs its acceptance |
| **G6 Integration** | integrating | verifier, human | All tasks are done and verified |
| **G7 Release** | releasing | human, operator | Deploy, rollback, monitoring and runbook are written down |

A gate can be **waived** only by a human, with a reason, and the waiver is
recorded in the audit log.

---

## Commands

```text
project-protocol init [project-dir] [--profile <generic|web-app|library|cli>] [--name <name>]
project-protocol status [dir] [--json]
project-protocol check [dir] [--stage <stage>] [--json]
project-protocol next [dir] [--role <role>] [--json]

project-protocol gate <G0..G7> --approve --by <role>:<name> [--task <T-NNN>] [--note <text>]
project-protocol gate <G0..G7> --waive   --by human:<name> --reason <text> [--task <T-NNN>]

project-protocol task list [dir] [--json]
project-protocol task claim <T-NNN> --by <role>:<name> [--dir <dir>]
project-protocol task report <T-NNN> --state <todo|ready|in_progress|review|blocked|done> [--note <text>] [--by <role>:<name>]

project-protocol evidence add --task <T-NNN> --kind <kind> --uri <file|url|commit> \
                              --verdict <pass|fail|inconclusive> --by <role>:<name>
project-protocol evidence list [--task <T-NNN>] [--json]
project-protocol verify <T-NNN> [--json]

project-protocol lease status [--json]
project-protocol guard commit --task <T-NNN> --staged [--observe] [--dir <dir>]
project-protocol reindex [dir] [--json]
project-protocol profile list [--json]
```

Exit codes are part of the contract:

| Code | Meaning |
|---|---|
| `0` | success; checks pass; gate approved |
| `2` | usage error |
| `3` | refused; checks fail; gate blocked; evidence missing |
| `4` | unavailable; state missing, artifact unreadable, git failure |

`--json` returns a stable envelope:

```json
{ "ok": true, "command": "check", "data": { "checks": [], "summary": {} } }
{ "ok": false, "command": "gate", "error": { "code": "GATE_BLOCKED", "message": "...", "details": {} } }
```

---

## Design principles

1. **The fixed `.project-protocol/` directory is the source of truth.** Its artifacts are committed Markdown; the
   JSON ledger is an index and an audit trail. `reindex` can rebuild it.
2. **No LLM in the core.** The protocol validates structure, roles, tasks and
   evidence. The model writes the content; the protocol checks it.
3. **Evidence over claims.** `task report --state done` refuses unless there is
   passing evidence. `inconclusive` is not a pass.
4. **No self-approval.** A gate's approver role cannot be the role that produced
   the work.
5. **Write domains are explicit.** `task claim` acquires a lease over the task's
   scope; `guard commit --staged` refuses paths outside the scope or leased by
   another task. `--observe` records what it would block without blocking.
6. **Few concepts.** Ticket, mandate, assignment, report, evidence, gate. No
   dashboard, no scheduler, no database server.
7. **A gate must be able to fail.** Every check has a negative control in
   `test/`; a check that cannot fail is not a check.

---

## What this is not

- Not a project manager or a Gantt chart.
- Not a task scheduler or a DAG executor.
- Not a model or a prompt library.
- Not a multi-user server (the ledger is local; use a shared store only after
  the single-writer design is tested).
- Not a replacement for code review, CI, or a human product decision.

---

## Development

```bash
npm test              # node:test, no dependencies
node --test test/     # same
```

Layout:

```text
src/core/     pure domain: artifacts, tasks, gates, evidence, leases, store
src/index.mjs public library surface (import this, not a deep path)
src/cli.mjs   argument parsing, human output, JSON envelope
templates/    the files `init` writes
schema/       JSON Schemas for the state, task, evidence and profile
test/         node:test suites and fixtures
```

See [`SPEC.md`](SPEC.md) for the normative protocol and [`AGENTS.md`](AGENTS.md)
for the rules an agent working on this repository follows.

---

## License

MIT. See [`LICENSE`](LICENSE).

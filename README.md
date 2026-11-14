# Trellis

**English** | [中文](README.zh.md)

[![CI](https://github.com/amsonix/trellis/actions/workflows/ci.yml/badge.svg)](https://github.com/amsonix/trellis/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

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
<project>/.trellis/
```

The Markdown artifacts there are the source of truth; `state.json`,
`evidence/T-*.jsonl` (an append-only shard per task), `leases.json` (active
leases only) and `leases.archive.jsonl` (released leases) are the ledger. `init` can run on an existing
project: it creates `.trellis/` and, once, the agent skill at
`.agents/skills/trellis/SKILL.md`. It never overwrites an existing file.

```text
intake → discovery → architecture → plan → ready → executing → integrating → releasing → maintained
```

---

## Quickstart

Requires Node.js 20 or newer. There are no runtime dependencies.

```bash
git clone https://github.com/amsonix/trellis.git
cd trellis
npm test

# Create the management directory of a project (new or existing)
node bin/trellis.mjs init /tmp/demo

# Optional: choose a profile or a display name
node bin/trellis.mjs init /tmp/demo --profile web-app --name demo

# Inspect it
node bin/trellis.mjs status --dir /tmp/demo
node bin/trellis.mjs check --dir /tmp/demo
node bin/trellis.mjs next --dir /tmp/demo --role architect

# Approve the first gate (a human does this, not the executor)
node bin/trellis.mjs gate G0 --approve --by human:alice --dir /tmp/demo
```

Or install the CLI from the repository — no npm registry needed:

```bash
npm install -g github:amsonix/trellis
trellis --help

# or run it once
npx github:amsonix/trellis --help

# or from a local clone
npm link
```

The package is not on the npm registry yet; `@amsonix/trellis` is reserved for
a future publish. A pushed `v*` tag now builds and attaches the tarball
automatically (see [`docs/release.md`](docs/release.md)):

```bash
npm install -g https://github.com/amsonix/trellis/releases/download/vX.Y.Z/amsonix-trellis-X.Y.Z.tgz
```

---

## What it creates

```text
<project>/.trellis/
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
  evidence/T-*.jsonl            per-task evidence shards (append-only)
  evidence/archive/T-*.jsonl    compacted-away retracted records
  leases.json                  active write leases (the execution constraint)
  leases.archive.jsonl         released leases (append-only)
```

A profile selects which artifacts are required. It is **optional**; the default
is `generic`.

It also writes `.agents/skills/trellis/SKILL.md` once, outside `.trellis/`: the
agent skill that tells a runtime how to operate this project (see
[Agent skill](#agent-skill)).

| Profile | Use | Required artifacts |
|---|---|---|
| `generic` | any project (default) | `PROJECT`, `ARCHITECTURE`, `ROADMAP`, `TASKS`, `VERIFICATION` |
| `web-app` | user-facing application | all of the above plus `OPERATIONS` and `RESEARCH` |
| `library` | reusable package / SDK | core five plus `RESEARCH`; `OPERATIONS` optional |
| `cli` | command-line tool | core five plus `RESEARCH`; `OPERATIONS` optional |

`--name` is also optional; it defaults to the project directory name.

---

## Agent skill

`init` writes the skill at `.agents/skills/trellis/SKILL.md`. Runtimes that read
the `.agents/skills/` convention — DSH among them — load it automatically when
the project is opened, so the agent starts from `status` and `next` instead of
guessing the stage.

The skill carries the rules that matter: claim a task before writing its scope,
record passing evidence before a `done` report, ask one question when blocked,
and never approve a gate for work you produced. The same brief is available from
the CLI: `trellis brief --role <role>`.

To make it available in every project, install it at the user level:

```bash
mkdir -p ~/.agents/skills
cp -R skills/trellis ~/.agents/skills/trellis
```

---

## MCP server

`bin/trellis-mcp.mjs` is a dependency-free MCP server over stdio. By default it
exposes the read side: `trellis_status`, `trellis_check`, `trellis_next`,
`trellis_brief`, `trellis_report`, `trellis_task_list`, `trellis_evidence_list`,
`trellis_verify`, `trellis_lease_status`, `trellis_profile_list` and
`trellis_export_a2a`.

With `TRELLIS_MCP_WRITE=1` it also exposes `trellis_init`, `trellis_task_add`,
`trellis_task_ask`, `trellis_task_answer`, `trellis_task_claim`,
`trellis_task_report`, `trellis_evidence_add`, `trellis_evidence_retract`,
`trellis_lease_release`, `trellis_task_recover`, `trellis_reindex` and
`trellis_compact`.

Gate approval is deliberately **not** exposed: a gate approver must not be the
role that produced the work, so that decision stays in the CLI.

DSH configuration:

```yaml
- id: mcp-trellis
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: trellis
    transport: stdio
    command: node
    args: ['/absolute/path/to/trellis/bin/trellis-mcp.mjs']
    env:
      TRELLIS_MCP_WRITE: '1'
```

The project directory comes from the tool argument, then `TRELLIS_DIR`, then the
current directory.

---

## The loop

`trellis next` is the loop contract. It returns either work the agent may run
without asking, or a stop with a reason:

```json
{ "kind": "tasks", "tasks": [ ... ], "needsUser": false, "reason": null }
{ "kind": "gate",  "gate": { ... }, "needsUser": true,  "reason": "gate G3 (Plan) needs approval" }
```

A runtime loops: run the `tasks` batch, claim each task, record evidence, report
`done`, then call `next` again. It stops only when `needsUser` is true — a gate,
a task review, a stale approval, a blocked task or a failing check. Ready work
never waits for a person; decisions do.

Writes are serialized through `.trellis/.lock`: two agents claiming, recording
evidence or asking questions at the same time queue behind each other instead of
overwriting one another. A lock older than twenty seconds is treated as stale and
stolen; a held lock refreshes its timestamp every five seconds.

Audit entries are appended to `.trellis/audit.jsonl`; `state.json` keeps only the
most recent 200. Set `TRELLIS_STRICT=1` to make `task claim` refuse before `G4`
instead of only warning. Set `TRELLIS_AGENT` to stamp leases, evidence and audit
entries with a worker id (attribution, not authentication). Set
`TRELLIS_MAX_LEASES=2` to cap how many leases one actor may hold; `next --limit N`
returns at most N tasks in a batch.

`trellis scope suggest` reads commits mentioning a task (`git log --grep`) and
proposes a file-level write scope. By default it only reads; `--apply --by
<role>:<name>` writes the suggestion back, and only narrowing is allowed.

`check` reports `GATE_CONTENT_DRIFT` (a warning) when only prose in an approved
artifact changed; structural edits still make the gate stale and require
re-approval.

`task edit` changes a field through the board validator and records
`task.edited`; a dependency edit makes plan gates stale, a prose edit shows as
content drift. `task list` filters by status, role, ready work and a limit. `task add --from`
imports a JSON array (the same fields as `task add`); it validates and appends
in order and stops at the first invalid item, leaving earlier imports in place.
`trellis compact --logs-keep 30` prunes `task finish` logs older than 30 days
that no evidence record references.

`trellis compact` folds the evidence event log into one record per id and
rotates `audit.jsonl` when it exceeds 5 MB; `--dry-run` reports the sizes.
`--archive-retracted <days>` moves retracted records older than that to
`evidence/archive/T-*.jsonl`; passing or failing evidence is never archived, because
verification still needs it.

### A2A endpoint

`trellis a2a serve [dir] [--port 8787] [--no-cancel]` starts a dependency-free
HTTP endpoint:

- `GET /.well-known/agent-card.json` — the agent card
- `POST /` JSON-RPC: `tasks/get`, `tasks/list`, `tasks/cancel`
- `tasks/cancel` maps to `task cancel` as `coordinator:a2a`; disable it with
  `--no-cancel`
- `message/send` is deliberately unsupported: work is created through the plan
  gates, not by an arbitrary A2A message

Before an upgrade, copy the ledger with `trellis backup --out <dir>`; restore
it with `trellis restore --from <dir> [--force]`. The trust boundary and the
threats Trellis does not handle are in
[`docs/security-model.md`](docs/security-model.md).

The lane model that inspired `--paths`, `lease reap` and the evidence tree
fields is documented in [`docs/lane-model.md`](docs/lane-model.md), including
the worktree recipe Trellis does not wrap.

Spec Kit users can capture a `tasks.md` checklist through
[`examples/spec-kit/`](examples/spec-kit/): Spec Kit keeps the spec and the plan,
Trellis records who is doing the work and what proves it.

---

## A2A export

`trellis export --a2a --json` projects the task board onto the A2A task
lifecycle for runtimes that speak it:

| Trellis | A2A |
|---|---|
| `todo`, `ready` | `submitted` |
| `in_progress`, `review` | `working` |
| `blocked` | `input-required` |
| `done` | `completed` |

The full Trellis status, role, scope, dependencies, acceptance and verification
stay under `metadata.trellis`; the export is read-only.

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

An approval records a digest of the artifacts it depends on. If they change —
`PROJECT.md`, `ROADMAP.md`, the task structure, an ADR — the gate becomes
**stale**: `check` fails with `GATE_STALE`, later gates are refused, and
`status` marks it `STALE` until it is re-approved. Task status changes and
whitespace-only edits do not make a gate stale; adding or reshaping a task, or
writing a new ADR, does.

---

## Commands

```text
trellis init [project-dir] [--profile <generic|web-app|library|cli>] [--name <name>]
trellis status [dir] [--json]
trellis check [dir] [--stage <stage>] [--json]
trellis next [dir] [--role <role>] [--limit <n>] [--json]
trellis brief [dir] [--role <role>] [--json]
trellis report [dir] [--json]

trellis gate <G0..G7> --approve --by <role>:<name> [--task <T-NNN>] [--note <text>]
trellis gate <G0..G7> --waive   --by human:<name> --reason <text> [--task <T-NNN>]

trellis task list [dir] [--json]
trellis task add --title <text> --scope <paths> --acceptance <text> --verification <text> \
                   [--role <role>] [--milestone <M0>] [--depends-on <T-NNN>] \
                   [--priority <high|medium|low>] [--follow-up-of <T-NNN>] \
                   --by <role>:<name>
trellis task claim <T-NNN> --by <role>:<name> [--paths <a,b>] [--dir <dir>]
trellis task ask <T-NNN> --question <text> --by <role>:<name>
trellis task answer <Q-NNN> --decision <text> --by human:<name>
trellis task recover <T-NNN> --by human:<name> --reason <text> [--to ready|todo]
trellis task cancel <T-NNN> --by human:<name> --reason <text>
trellis task finish <T-NNN> --run <command> --by <role>:<name>
trellis task edit <T-NNN> [--acceptance <a>] [--depends-on <list>] --by <role>:<name>
trellis task add --from <tasks.json> --by <role>:<name>
trellis doc list [dir] [--json]
trellis doc show <ID> [dir] [--json]
trellis doc check <ID> [dir] [--json]
trellis doc scaffold <ID> --by <role>:<name> [dir]
trellis adr new --title <decision> [--status proposed|accepted|superseded] --by <role>:<name>
trellis task list [dir] [--status <s>] [--role <r>] [--ready] [--limit <n>]
trellis task report <T-NNN> --state <todo|ready|in_progress|review|blocked|done> [--note <text>] [--by <role>:<name>]

trellis evidence add --task <T-NNN> --kind <kind> --uri <file|url|commit> \
                              --verdict <pass|fail|inconclusive> --by <role>:<name>
trellis evidence retract <EV-id> --by <role>:<name> --reason <text>
trellis evidence list [--task <T-NNN>] [--json]
trellis verify <T-NNN> [--json]

trellis lease status [--json]
trellis lease release <T-NNN> --by <role>:<name>
trellis lease reap --older-than <hours> --by human:<name>
trellis guard commit --task <T-NNN> (--staged | --paths <a,b>) [--observe] [--dir <dir>]
trellis reindex [dir] [--json]
trellis compact [dir] [--dry-run] [--archive-retracted <days>] [--json]
trellis export --a2a [dir] [--json]
trellis scope suggest --task <T-NNN> [dir] [--apply --by <role>:<name>] [--json]
trellis profile list [--json]
trellis doctor [dir] [--json]
trellis help [command] [subcommand]
```

`trellis report` answers "where is this project and what is blocking it": gate
and task counts, per-milestone progress derived from the task board, blocking
checks, blocked tasks, tasks marked done without passing evidence, and leases
older than 24 hours.

New requirements and bug reports go in through `trellis task add`: it validates
the milestone, role, acceptance, verification and write scope (relative paths
only: no `..`, `*` or absolute prefixes) before
appending the row to `.trellis/docs/TASKS.md`, and records `task.added` in the
audit. If the work overlaps an open task, pass `--depends-on` instead of widening
its scope.

Failed evidence can be retracted by a human, reviewer or verifier with a reason:
`evidence retract <EV-id> --reason "..."`. The record stays in its task shard
marked `retracted` and stops blocking `done`, so the bug flow is real: record the
failing reproduction, fix it, retract the failure, add the passing evidence. The
producing role cannot retract its own failure.

Work discovered during execution can keep the loop running: `task add
--follow-up-of T-NNN` inherits the parent's milestone, must sit inside the
parent's scope, depends on it, and does **not** re-open G3/G4. It is capped at
three follow-ups per task and two levels deep; anything else still stales the
plan gates and needs a human.

Decisions travel as questions: `task ask` blocks the task and records the
question, `next`/`report` surface it as `needsUser`, and only a human can
`task answer`. The task then returns to the status it had before the question.

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

1. **The fixed `.trellis/` directory is the source of truth.** Its artifacts are committed Markdown; the
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
npm run coverage      # test + the coverage gate CI enforces
```

Layout:

```text
src/core/     pure domain: artifacts, tasks, gates, evidence, leases, store
src/index.mjs public library surface (import this, not a deep path)
src/cli.mjs   argument parsing, human output, JSON envelope
src/mcp/      MCP server over stdio
templates/    the files `init` writes
skills/       the agent skill `init` writes into a project
schema/       JSON Schemas for the state, task, evidence and profile
test/         node:test suites and fixtures
```

See [`SPEC.md`](SPEC.md) for the normative protocol and [`AGENTS.md`](AGENTS.md)
for the rules an agent working on this repository follows. 中文参考：
[`SPEC.zh.md`](SPEC.zh.md) · [`CONTRIBUTING.zh.md`](CONTRIBUTING.zh.md) ·
[`docs/v0.3.0-plan.md`](docs/v0.3.0-plan.md).

Contributions are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues and
pull requests live at <https://github.com/amsonix/trellis>. Report security
issues privately, as described in [`SECURITY.md`](SECURITY.md).

---

## Acknowledgments

The stage and gate model in Trellis is informed by DeepSeek's Super Agent. This
is an independent implementation: the repository contains no code from that
project, and nothing here depends on it at runtime.

---

## License

MIT. See [`LICENSE`](LICENSE).

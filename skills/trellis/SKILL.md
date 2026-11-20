---
name: trellis
version: 1.0.0
description: "Use when a project contains a .trellis/ directory, when the user mentions Trellis, stages, gates, tasks, leases or evidence, or when you are asked to plan, review, verify or release a project that uses this protocol. Reads the protocol state before writing, claims tasks, records evidence and never self-approves. 中文：项目里有 .trellis/，或用户提到 Trellis、阶段、gate、任务、租约、证据时使用。"
whenToUse: "Any change to a project that has .trellis/, or any request to plan, review, verify or release such a project."
---

# Trellis

Trellis is a file-based protocol for building a project. `.trellis/` is the
source of truth; `state.json`, `evidence/T-*.jsonl`, `leases.json` and
`leases.archive.jsonl` are the ledger.
The CLI is the interface; prefer `--json` and read the envelope.

If `trellis` is not on `PATH` but the repository is checked out, use
`node <repo>/bin/trellis.mjs` instead.

## Bootstrapping a new project

When the user describes a new project or feature, do not start from the task
board and do not create every artifact at once. Work top-down, one gate at a
time:

1. `trellis init . --name <name> --empty-tasks`. The empty board refuses
   `task add` until G2 is approved, which is deliberate.
2. Write only the current gate's artifact:
   - G0: `PROJECT.md`
   - G1: `RESEARCH.md` (or ask the human to waive G1 when research is not needed)
   - G2: `ARCHITECTURE.md` + ADRs
3. After each layer, run `trellis doc check <ARTIFACT>` and **stop**. Ask the
   human to approve the gate (`trellis gate G0 --approve --by human:<name>`).
   Do not write the next layer until that gate is passed or waived.
4. At G3, write `ROADMAP.md` and `VERIFICATION.md` first. Then add tasks from
   the ROADMAP exit criteria, with `--milestone` and `--source`, and run
   `trellis plan coverage --strict`. Only then ask for G3.
5. After G4, use `next` for execution. A new requirement after G4 becomes a
   task; before G3 it belongs in PROJECT/ROADMAP, not TASKS.

If G1 is not needed (the domain is already understood), ask the human to run
`trellis gate G1 --waive --by human:<name> --reason "..."`; do not create an
empty `RESEARCH.md` and do not approve the gate yourself.

If the project already exists, skip `init` and start at `brief`/`next`.

## Before any write

0. If a task's scope is a directory, run `trellis scope suggest --task T-NNN`
   before claiming it. Narrow with `trellis scope suggest --task T-NNN --apply
   --by <coordinator>:<name>` when the suggestion is a file inside the current
   scope. Do not add a dependency just because two tasks share a directory.
1. `trellis brief --role <your-role> --json` — the current gate, what to read,
   what to write, and what you must not do.
2. `trellis status --json` — where the project is.
3. `trellis next --batch <n> --role <your-role> --json` — the only allowed
   candidate set.
4. Read the artifacts named by `brief` before touching anything.

Flags are command-scoped: do not assume `--dry-run` or `--force` exists on a
new command; an unknown combination is a USAGE error.

If a task is complete or blocked and you need a human decision, move it to
`pending` with a reason; do not leave it `in_progress` and do not use `review` or
`blocked` (legacy). The human resolves it with `task decide`; agents cannot.

If `next` and the user's request disagree, say so and ask. Do not silently
switch stages or skip a gate.

When the user asks where the project stands, run `trellis status --panel` for a
one-screen view, or `trellis report` for the detailed gaps. Use `--json` for
machine decisions; `--json` wins if both are given.

If the runtime exposes Trellis MCP tools (`trellis_*`), they follow the same
rules. Gate approval is not available there by design; a human runs it from the
CLI.

## Capturing new work

After G3, when the user gives you a requirement, a bug report or test feedback,
put it on the task board instead of only discussing it. Before G3, it belongs in
`PROJECT.md` or `ROADMAP.md`, not in `TASKS.md`:

```bash
trellis task add --title "<one line>" --scope "<paths>" \
  --acceptance "<what proves it done>" --verification "<how it is checked>" \
  --source "ROADMAP#M2/exit-1" --by coordinator:<you>
```

If the scope overlaps an open task, pass `--depends-on T-NNN` instead of
widening it. Every task derived from a document should carry `--source`; a task
created with `--parent` inherits the parent's source, but a `--follow-up-of`
does not. Before approving G3 run `trellis plan coverage --strict` and close the
gaps. When a finished task leaves boundary work, create it explicitly with
`trellis task derive <parent> --kind child|follow-up ...`; nothing is derived
automatically. A task without a source is an orphan, not a covered requirement. `--milestone` defaults to the first milestone. Ask one question only
when the scope or the acceptance is genuinely unknown.

Before adding, check the backlog (`trellis status` / `task list --ready`). If
`TRELLIS_MAX_OPEN` is set, `task add` refuses at the limit; only a human may pass
`--force`.

For a bug, record the failing reproduction with `--verdict fail`, fix it, have a
reviewer or verifier retract the failing record with a reason, then add the
passing evidence. The retracted record stays in the ledger; the producing role
cannot retract its own failure.

## Running a batch

Call `trellis next --batch <n> --role <your-role> --context --json`; the
`read` array names the files to inspect before working. The returned
`tasks` array is the **only** candidate set: priority/age ordered,
scope-disjoint, each with a `why`.

The selection contract:

1. Claim only tasks from `next.tasks`; default to the first claimable one.
2. One claim at a time unless you are running parallel lanes; `--batch` is a
   candidate set, not a reservation.
3. If a claim fails, do **not** open the board and pick another task:
   - `LEASE_CONFLICT` / `TASK_LEASE_HELD_BY_OTHER` → try the next candidate in
     the same batch; if all fail, stop and report.
   - `TASK_BLOCKED_BY_DEPENDENCY` / `TASK_ROLE` / `LEASE_LIMIT` → re-run `next`
     with the right role or after releasing; do not guess.
   - `TASK_STATUS_INVALID` / `TASK_PRIORITY_INVALID` → stop; the board is broken.
4. Before writing, read the task's `read` set (`task show <ID> --context` when
   you need the full task, parent/children, evidence and leases). The task row
   is a pointer, not the whole specification.
5. After each `report --state done` (or `task finish`), call `next` again. Never
   reuse an old candidate list.
6. `kind: "gate"` or `kind: "waiting"` → stop and surface `reason`; do not
   bypass with `task list`. `candidate` is a preview, not permission.
7. `task list` is for diagnosis and backlog review only. It is never a
   selection input.

If `batchShortfall > 0`, work with what is available; do not fill the gap from
the board.

### Delegating a batch

When the host supports subagents and `next --batch` returns more than one task,
delegate one task per child instead of doing them sequentially:

1. The parent **does not claim**. It passes each child:
   - one task id and that task's `read` list
   - the same project directory
   - a unique `--by` actor (`executor:lane-<id>`)
   - the instruction to claim, work, record evidence and report done, then stop
2. The parent never reports a child's task done, never edits the board to retry,
   and never starts more children than the returned batch.
3. If the host has no subagent primitive, run sequentially; do not fake
   parallelism by claiming several tasks in one agent.
4. On a child failure: leave the evidence/state as the child left it. Use
   `lease reap` or `task recover` only for a crashed holder. Re-run `next` rather
   than picking a replacement from the board.

If a child uses a worktree, remove it after the work lands:

```bash
git worktree remove .trellis/worktrees/<T-NNN>
git worktree prune
```

Never remove a tree with uncommitted work, and delete the branch only after it
is merged. `task finish` warns `WORKTREE_REMAINS` for the conventional path.

See `examples/host-orchestrator.md` for the full prompt template and DSH
mapping. Trellis itself has no execution engine and never spawns an agent.

While doing a task you may discover work that is *part of* it: add it with
`--parent <T-NNN>`. Containment means the parent cannot be marked done until
the child is done or canceled, and the child must stay inside the parent's
scope. The parent must have released its lease before spawning. Use
`--follow-up-of` only for ordering (child waits for parent), and never use
either for unrelated work.

Before reporting a parent `done`, check `openChildren` from `task list` or
`next`; `TASK_OPEN_CHILDREN` is a refusal, not a warning. While a child is open
the parent cannot be claimed either (`PARENT_HAS_OPEN_CHILDREN`). To abandon a parent
and its children together, a human uses `task cancel --cascade`.

Milestones are not closed by task completion. When `status` shows
`MILESTONE_READY`, a human or coordinator checks the exit criteria and runs
`trellis milestone close M2 --by ... --note "..."`. Do not mark a milestone done
because its task count reached zero. A document's approval comes from its gate:
use `trellis doc list` (gate state), not a `status:` line in the file.

## The rules

1. **A stage is not a suggestion.** Write only the artifacts the current stage
   requires; `trellis check` names the ones that fail.
2. **Claim before you write.** `trellis task claim T-00N --by <role>:<name>`
   creates the lease; `trellis guard commit --task T-00N --staged` enforces it.
3. **Done needs evidence.** `task report --state done` is refused without a
   passing evidence record. `inconclusive` is not a pass.
4. **Never approve your own work.** A gate approver must not be the role that
   produced the work. A human approves; you produce the evidence and ask.
5. **Blocked is one question.** Use `trellis task ask T-NNN --question "..."`;
   it blocks the task, records the question and surfaces it as `needsUser`.
   Never write a status essay, and never answer your own question.
6. **Do not edit the ledger by hand.** Use `evidence add`, `task report`,
   `gate` and `reindex`. The JSON files are an index and an audit trail.
7. **A stale gate is re-approved, not skipped.** If `check` reports
   `GATE_STALE`, re-approve that gate first; do not edit the ledger and do not
   approve later gates around it.

## Commands

```text
trellis status [dir] [--json]
trellis check [dir] [--stage <stage>] [--json]
trellis next [dir] [--role <role>] [--batch <n>] [--strategy priority|unblock|oldest] [--json]
trellis brief [dir] [--role <role>] [--json]
trellis report [dir] [--json]

trellis task list [dir] [--json]
trellis task add --title <text> --scope <paths> --acceptance <text> --verification <text> [--priority <high|medium|low>] --by <role>:<name>
trellis task claim <T-NNN> --by <role>:<name>
trellis task ask <T-NNN> --question <text> --by <role>:<name>
trellis task answer <Q-NNN> --decision <text> --by human:<name>
trellis task recover <T-NNN> --by human:<name> --reason <text> [--to ready|todo]
trellis task cancel <T-NNN> --by human:<name> --reason <text>
trellis task finish <T-NNN> --run <command> --by <role>:<name>
trellis task report <T-NNN> --state <todo|ready|in_progress|pending|done> [--reason <text>] --by <role>:<name>
trellis task decide <T-NNN> --decision accept|rework|cancel --by human:<name>

trellis evidence add --task <T-NNN> --kind <kind> --uri <file|url|commit> --verdict <pass|fail|inconclusive> [--proves <text>] --by <role>:<name>
trellis evidence list [--task <T-NNN>] [--json]
trellis evidence retract <EV-id> --by <role>:<name> --reason <text>
trellis verify <T-NNN> [--json]

trellis lease status [--json]
trellis lease release <T-NNN> --by <role>:<name>
trellis guard commit --task <T-NNN> (--staged | --paths <a,b>) [--observe]

trellis gate <G0..G7> --approve --by <role>:<name> [--task <T-NNN>] [--note <text>]
trellis gate <G0..G7> --waive --by human:<name> --reason <text> [--task <T-NNN>]

trellis reindex [dir] [--json]
trellis compact [dir] [--dry-run] [--archive-retracted <days>] [--json]
trellis scope suggest --task <T-NNN> [dir] [--apply --by <role>:<name>] [--json]
trellis profile list [--json]
trellis doctor [dir] [--json]
trellis help [command] [subcommand]
```

Exit codes: `0` success · `2` usage · `3` refused, checks fail or gate blocked ·
`4` unavailable. Envelope: `{ ok, command, data }` or
`{ ok: false, command, error: { code, message, details } }`.

## Roles and stages

Roles: `human`, `coordinator`, `architect`, `executor`, `reviewer`,
`verifier`, `operator`. Act as exactly one and pass it to `--by role:name`.

Stages and gates:

| Gate | Stage | Approver |
|---|---|---|
| G0 | intake | human |
| G1 | discovery | architect, human |
| G2 | architecture | architect, human |
| G3 | plan | human |
| G4 | ready | coordinator, human |
| G5 | executing (per task) | reviewer |
| G6 | integrating | verifier, human |
| G7 | releasing | human, operator |

## If the project has no .trellis/

Run `trellis init <dir>` first. It works on an existing project, creates
`.trellis/` and never overwrites an existing file. Then start at G0.

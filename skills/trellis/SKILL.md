---
name: trellis
version: 1.0.0
description: "Use when a project contains a .trellis/ directory, when the user mentions Trellis, stages, gates, tasks, leases or evidence, or when you are asked to plan, review, verify or release a project that uses this protocol. Reads the protocol state before writing, claims tasks, records evidence and never self-approves. 中文：项目里有 .trellis/，或用户提到 Trellis、阶段、gate、任务、租约、证据时使用。"
whenToUse: "Any change to a project that has .trellis/, or any request to plan, review, verify or release such a project."
---

# Trellis

Trellis is a file-based protocol for building a project. `.trellis/` is the
source of truth; `state.json`, `evidence.json` and `leases.json` are the ledger.
The CLI is the interface; prefer `--json` and read the envelope.

If `trellis` is not on `PATH` but the repository is checked out, use
`node <repo>/bin/trellis.mjs` instead.

## Before any write

1. `trellis brief --role <your-role> --json` — the current gate, what to read,
   what to write, and what you must not do.
2. `trellis status --json` — where the project is.
3. `trellis next --role <your-role> --json` — the one action allowed now.
4. Read the artifacts named by `brief` before touching anything.

If `next` and the user's request disagree, say so and ask. Do not silently
switch stages or skip a gate.

When the user asks where the project stands, run `trellis report` first: it
lists the gate and task counts and the concrete gaps.

If the runtime exposes Trellis MCP tools (`trellis_*`), they follow the same
rules. Gate approval is not available there by design; a human runs it from the
CLI.

## Capturing new work

When the user gives you a requirement, a bug report or test feedback, put it on
the task board instead of only discussing it:

```bash
trellis task add --title "<one line>" --scope "<paths>" \
  --acceptance "<what proves it done>" --verification "<how it is checked>" \
  --by coordinator:<you>
```

If the scope overlaps an open task, pass `--depends-on T-NNN` instead of
widening it. `--milestone` defaults to the first milestone. Ask one question only
when the scope or the acceptance is genuinely unknown.

For a bug, record the failing reproduction with `--verdict fail`, fix it, have a
reviewer or verifier retract the failing record with a reason, then add the
passing evidence. The retracted record stays in the ledger; the producing role
cannot retract its own failure.

## Running a batch

Call `trellis next --json`. If `needsUser` is false, do every task in `tasks`
(claim → work → evidence → `report --state done`) and call `next` again. If it
is true, stop and surface `reason`; do not invent work to keep going.

While doing a task you may discover follow-up work inside the same milestone:
add it with `--follow-up-of <T-NNN>`. That does not re-open the plan gates.
Do not use it for unrelated work or for anything outside the parent's scope.

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
trellis next [dir] [--role <role>] [--json]
trellis brief [dir] [--role <role>] [--json]
trellis report [dir] [--json]

trellis task list [dir] [--json]
trellis task add --title <text> --scope <paths> --acceptance <text> --verification <text> [--priority <high|medium|low>] --by <role>:<name>
trellis task claim <T-NNN> --by <role>:<name>
trellis task ask <T-NNN> --question <text> --by <role>:<name>
trellis task answer <Q-NNN> --decision <text> --by human:<name>
trellis task report <T-NNN> --state <todo|ready|in_progress|review|blocked|done> --by <role>:<name>

trellis evidence add --task <T-NNN> --kind <kind> --uri <file|url|commit> --verdict <pass|fail|inconclusive> --by <role>:<name>
trellis evidence list [--task <T-NNN>] [--json]
trellis evidence retract <EV-id> --by <role>:<name> --reason <text>
trellis verify <T-NNN> [--json]

trellis lease status [--json]
trellis lease release <T-NNN> --by <role>:<name>
trellis guard commit --task <T-NNN> --staged [--observe]

trellis gate <G0..G7> --approve --by <role>:<name> [--task <T-NNN>] [--note <text>]
trellis gate <G0..G7> --waive --by human:<name> --reason <text> [--task <T-NNN>]

trellis reindex [dir] [--json]
trellis compact [dir] [--dry-run] [--archive-retracted <days>] [--json]
trellis scope suggest --task <T-NNN> [dir] [--apply --by <role>:<name>] [--json]
trellis profile list [--json]
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

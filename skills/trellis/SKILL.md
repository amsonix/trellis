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

## The rules

1. **A stage is not a suggestion.** Write only the artifacts the current stage
   requires; `trellis check` names the ones that fail.
2. **Claim before you write.** `trellis task claim T-00N --by <role>:<name>`
   creates the lease; `trellis guard commit --task T-00N --staged` enforces it.
3. **Done needs evidence.** `task report --state done` is refused without a
   passing evidence record. `inconclusive` is not a pass.
4. **Never approve your own work.** A gate approver must not be the role that
   produced the work. A human approves; you produce the evidence and ask.
5. **Blocked is one question.** Report `blocked` with a single concrete
   question, not a status essay.
6. **Do not edit the ledger by hand.** Use `evidence add`, `task report`,
   `gate` and `reindex`. The JSON files are an index and an audit trail.

## Commands

```text
trellis status [dir] [--json]
trellis check [dir] [--stage <stage>] [--json]
trellis next [dir] [--role <role>] [--json]
trellis brief [dir] [--role <role>] [--json]

trellis task list [dir] [--json]
trellis task claim <T-NNN> --by <role>:<name>
trellis task report <T-NNN> --state <todo|ready|in_progress|review|blocked|done> --by <role>:<name>

trellis evidence add --task <T-NNN> --kind <kind> --uri <file|url|commit> --verdict <pass|fail|inconclusive> --by <role>:<name>
trellis evidence list [--task <T-NNN>] [--json]
trellis verify <T-NNN> [--json]

trellis lease status [--json]
trellis lease release <T-NNN> --by <role>:<name>
trellis guard commit --task <T-NNN> --staged [--observe]

trellis gate <G0..G7> --approve --by <role>:<name> [--task <T-NNN>] [--note <text>]
trellis gate <G0..G7> --waive --by human:<name> --reason <text> [--task <T-NNN>]

trellis reindex [dir] [--json]
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

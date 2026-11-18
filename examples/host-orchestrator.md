# Host-side orchestration: delegating a batch to subagents

Trellis decides **what** is ready; the host decides **who runs it**. The CLI has
no execution engine and never spawns agents. This page is the contract for a host
that does have subagents (DSH, Claude Code, or a custom runner).

## When to delegate

Delegate only when all of these hold:

1. `trellis next --batch N --role <role> --context --json` returns `kind: "tasks"`
   with `N > 1`.
2. The host exposes a subagent primitive.
3. You can give each subagent the same project directory (`--dir`).

If the host has no subagent primitive, run the batch sequentially. Do not fake
parallelism by claiming several tasks in one agent.

## Parent responsibilities

The parent **does not claim** the batch. Claiming is the child's first action; a
parent that claims first is holding a lease it will not work on.

```text
1. next --batch N --context
2. for each task in tasks:
     spawn a child with:
       - task id
       - task.read (files to inspect)
       - the project directory
       - a unique actor: executor:lane-<id>
       - this prompt template (below)
3. monitor: status, lease status, child reports
4. after all children finish: next again
```

Parent must not:

- claim a task it delegates
- report a child's task `done` on its behalf
- retry a child by editing the board
- start more children than `--batch` returned

## Child prompt template

```text
You are lane <actor>. Work on exactly one task: <T-NNN>.

Project: <absolute dir>
Read first: <task.read, one per line>

1. trellis task claim <T-NNN> --by <actor> [--paths <subset>]
2. Do the work inside the task scope.
3. Record evidence (trellis evidence add, or trellis task finish --run).
4. trellis task report <T-NNN> --state done --by <actor>
5. Stop. Do not pick another task; do not read the board to choose.

If claim fails, stop and report the error code. Do not switch to another task.
```

Each child gets a **unique actor**. Two children using `executor:lane` are one
identity and will look like a takeover to the lease ledger.

## DSH mapping

In DSH, spawn one `subagent` per task, with `cwd` set to the project and the full
prompt above (subagents do not inherit the parent conversation; `subagent_fork`
does, but still needs the task id and actor). The parent waits for each child's
result; `send_message` is only for steering a running child.

Do not use the A2A endpoint for dispatch: `message/send` is refused by design and
`tasks/cancel` is for humans.

## Failure handling

| Child outcome | Parent action |
|---|---|
| `LEASE_CONFLICT` at claim | Do not retry from the board; re-run `next` (the batch may be stale) |
| `PARENT_HAS_OPEN_CHILDREN` | The child is derived from a parent that is itself active; finish the child first or pick another candidate |
| work failed, fail evidence added | Leave it; the task stays open. A human/reviewer retracts or reopens |
| child crashed, lease still held | `trellis lease reap --older-than <h>` (human/coordinator) or `task recover` |
| child reports done without evidence | Refused by `report`; do not override |
| all children finished | Parent runs `next` again; it does not summarise into a fake done |

## Why the parent does not aggregate

The parent is an orchestrator, not a second writer. Aggregating results means
editing tasks or evidence the child produced, which duplicates the audit trail.
The board and the evidence ledger are the aggregation.

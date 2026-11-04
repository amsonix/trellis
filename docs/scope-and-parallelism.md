# Scope is the only concurrency primitive

Status: decided, 2026-11-04. Applies to 0.5.x and later until replaced by a
superseding decision.

## Decision

Trellis does **not** add a `parallel_ok` or `with:` declaration. Two tasks may
run concurrently when:

1. their dependencies are done, and
2. their write scopes do not overlap.

There is no third way. `scope` carries both the write domain and the
serialization decision, and that is intentional: the thing that is safe to
parallelize is exactly the thing that is disjoint on disk.

## Why not an explicit parallel declaration

The only case a declaration would unlock is **two tasks writing the same file**
(or a directory scope too coarse to separate them). Those are different
problems:

- Coarse scope, different files under one directory → narrow the scope. This is
  what `trellis scope suggest --apply` is for.
- Same file, concurrent writers → not a parallelism problem. A lease can stop
  both from claiming, but it cannot stop two processes from writing the same
  lines once both are granted. A declaration would turn "write domain is data"
  into "write domain is a promise", which is the property the protocol exists to
  avoid.

If two tasks really must share a file, serialize them with a dependency. That is
honest: it records that the order matters.

## How to narrow

```bash
# what the commits for this task actually touched
trellis scope suggest --task T-012

# write the narrowed scope back (only narrowing is allowed)
trellis scope suggest --task T-012 --apply --by coordinator:kim
```

Apply this before claiming a task whose scope is a directory. A wide scope does
not make the task safer; it makes every other task wait.

## What not to do

- Do not generate dependencies from scope overlap. A dependency says "B must
  happen after A"; overlap only says "they must not write at the same time".
  Turning one into the other is what produced a 32-level chain on a 96-task
  board.
- Do not widen scope to "make it fit". That trades a visible serialization for an
  invisible collision risk.
- Do not rely on `priority` for concurrency. It orders ready tasks; it does not
  make them disjoint.

## G4 stays a hard gate (decided 2026-11-04)

G4 keeps rejecting plans where two runnable tasks share a scope without a
dependency. The alternative — downgrading the overlap check to a warning and
letting leases serialize at claim time — was considered and rejected:

- leases are a **runtime** safety device (they stop a second claim); they do not
  tell the planner which work can run at the same time
- with the hard gate, "G4 approved" still means "this plan can execute without
  agents blocking each other"
- the complaint that motivated the alternative was real but had a different
  cause: narrowing two tasks to the **same file** cannot remove a conflict. The
  remedy is a dependency, and the G4 message now says exactly that.

A project with many tasks and few files therefore needs a serial chain (or
smaller tasks). That is the cost of keeping the guarantee, and it is deliberate.

## Consequences

- Parallelism is bounded by how precisely scopes are written. `scope suggest`
  makes that cheap; nothing else does.
- G4 remains the plan gate: it refuses a board where two runnable tasks overlap,
  and the only remedies are a dependency or a narrower scope.
- If a future deployment needs true same-file concurrency, it needs a file lock
  or a merge strategy, not a task-board column.

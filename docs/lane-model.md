# Lanes, leases and worktrees

Trellis borrows several ideas from the **lane** model used by `vela-engine`
(a local rendering-engine project; its `scripts/lane.sh` and `docs/lanes/` are
not part of this repository). This page records what was
adopted, what was deliberately not, and how to get the rest with plain git.

## The lane model in one paragraph

A lane is a unit of parallel work with **physical** isolation: its own git
worktree, its own build directory, and its own append-only record file. Landing
is a chain: run the lane's tests, fast-forward merge, run the main tree's tests,
roll back if the main tree goes red. A stale lane's lock must be recoverable,
and the lane record is the evidence of what was measured.

## What Trellis adopted

| Lane idea | Trellis mechanism |
|---|---|
| A record knows which tree produced it | `evidence` stores `commit`, `dirty`, `worktree`; `verify` warns `EVIDENCE_TREE_DRIFT` when HEAD moved |
| See who holds the work and for how long | `lease status` prints the actor, agent and age |
| Run the check before claiming done | `task finish --run "<command>"`: log, evidence, `done` only on exit 0 |
| A dead holder must not block forever | `lease reap --older-than <hours> --by human:<name>` |
| Work on one file without owning the directory | `task claim --paths <a,b>` leases only the named subset |

## What Trellis deliberately does not do

- **Worktree per task.** Trellis isolates by *lease*, not by directory. Running
  each task in its own worktree is a git recipe, not a protocol rule; see below.
- **A land command.** Trellis has no merge step. `task finish` proves the work;
  merging is the project's CI/reviewer's job. A rollback chain would duplicate
  git and CI.
- **Process sweeping.** Trellis never kills processes. An orphaned agent is a
  lease problem (`lease reap`), not a process problem.
- **Global numbering.** vela lanes avoid numbering collisions by assigning
  numbers only at fold-in. Trellis has no global sequence to protect: tasks and
  evidence are per-file.

## Getting worktree isolation without a command

```bash
# one task per worktree
git worktree add .trellis/worktrees/T-144 -b lane/T-144
cd .trellis/worktrees/T-144
trellis task claim T-144 --by executor:json-infinity --paths bench/results/frame_gate.py
# ... work, run tests, record evidence ...
cd -
trellis task finish T-144 --run "npm test" --dir .
```

Add `.trellis/worktrees/` to `.gitignore`. The lease is still the source of
truth: a worktree does not by itself grant write permission.

## Failure modes this model keeps

- A lease held by a lane that died: recover with `lease reap` (audited, human
  only). There is no automatic TTL, because silently stealing a live lease is
  worse than making a human decide.
- Two tasks in one scope: G4 still refuses the plan unless one depends on the
  other. `--paths` narrows the *runtime* lease, not the plan invariant.
- A glob in a scope: rejected at claim time. A lane that needs a wildcard should
  list the files or own the directory.

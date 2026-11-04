# Spec Kit integration

[Trellis](../SPEC.md) and [Spec Kit](https://github.com/github/spec-kit) solve
different halves of the same problem:

- Spec Kit drives **what to build**: constitution → specify → plan → tasks.
- Trellis drives **who is doing it and what proves it**: gates, leases, evidence,
  questions and the loop contract.

They compose; neither replaces the other.

## Mapping

| Spec Kit step | Trellis surface |
|---|---|
| `/speckit.constitution` | `PROJECT.md` acceptance + `INVARIANTS.md` |
| `/speckit.specify` | `RESEARCH.md` / `PROJECT.md` scope and non-goals |
| `/speckit.plan` | `ARCHITECTURE.md`, `docs/adr/` |
| `/speckit.tasks` | `TASKS.md` through `examples/spec-kit/sync.mjs` |
| `/speckit.implement` | `task claim` → work → `evidence add` → `report done` |
| `/speckit.analyze` | `trellis check` + `trellis report` |
| `/speckit.clarify` | `task ask` (only a human answers) |

## Capture a `tasks.md` checklist

```bash
node examples/spec-kit/sync.mjs \
  --dir /path/to/project \
  --file specs/001-feature/tasks.md \
  --scope src/feature \
  --verification "npm test" \
  --by coordinator:spec-kit
```

The bridge parses `- [ ] T012 [P] Add the parser`, skips `- [x]`, prefixes the
title with the source id (`[T012] ...`) so a second run is idempotent, and
validates the write scope before writing.

## A hook after `/speckit.tasks`

Spec Kit runs prompts in the agent's chat. Add this to the agent instruction or
to a project-local extension step:

```text
After generating tasks.md, run:
  node examples/spec-kit/sync.mjs --dir . --file <tasks.md> \
    --scope <paths> --verification "<command>" --by coordinator:spec-kit
Then run `trellis check` and `trellis next --json`. Do not claim a task whose
acceptance is still the placeholder.
```

## Limits

- The bridge creates tasks, not specs. Spec Kit remains the source for the spec
  and the plan.
- Acceptance is a placeholder (`Spec Kit T0NN is implemented...`). A human or
  the architect must refine it before the task is claimed.
- Created tasks depend on each other because they share one write scope; edit
  the table if the work is genuinely parallel.
- Titles are prefixed with the source id; renaming in Spec Kit does not rename
  the Trellis task.

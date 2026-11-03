# {{PROJECT_NAME}}

> Created with [trellis](https://github.com/amsonix/trellis)
> on {{DATE}} using the `{{PROFILE}}` profile.

## What this is

Describe the project in one paragraph. The authoritative scope, non-goals and
acceptance criteria live in [`PROJECT.md`](PROJECT.md); this README is the
quickstart.

## Quickstart

```bash
# fill in the real commands for this project
echo "replace me"
```

## Status

The project is in the `intake` stage. Start with:

```bash
trellis status
trellis next --role architect
```

## Documents

- [`PROJECT.md`](PROJECT.md) — problem, scope, non-goals, acceptance
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestones and exit criteria
- [`docs/TASKS.md`](docs/TASKS.md) — the task board
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — how correctness is checked
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deploy, rollback, runbook

The agent skill for this project is at
[`../.agents/skills/trellis/SKILL.md`](../.agents/skills/trellis/SKILL.md): it
tells an agent to read `status` and `next` before writing, claim a task before
touching its scope, record evidence, and never approve its own work.

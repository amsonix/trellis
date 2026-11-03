# Spec Kit capture bridge

[Spec Kit](https://github.com/github/spec-kit) turns a specification into a plan
and a `tasks.md` checklist. Trellis does not replace that process; it adds the
part Spec Kit leaves to the agent's memory: who claimed a task, what evidence
proves it, and when an approval goes stale.

This example is the smallest useful bridge: it reads a Spec Kit `tasks.md`,
ignores the completed items, and creates one Trellis task per open item.

```bash
node examples/spec-kit/sync.mjs \
  --dir /path/to/project \
  --file .specify/specs/001-feature/tasks.md \
  --scope src/feature \
  --verification "npm test" \
  --by coordinator:spec-kit
```

What it does:

- parses lines like `- [ ] T012 [P] Add the parser`
- skips `- [x]` items
- prefixes the title with the source id (`[T012] Add the parser`) so a second
  run does not duplicate it
- calls `task add`, so the milestone, role, acceptance, verification and write
  scope are validated before anything is written

What it does **not** do:

- it does not copy Spec Kit's plan or spec into `.trellis/`; those stay where
  Spec Kit put them
- it does not invent acceptance criteria: it records a placeholder that a human
  or the architect must refine before the task is claimed
- it does not run Spec Kit; point `--file` at the output

The intended split: Spec Kit owns *what to build*; Trellis owns *who is doing it
and what proves it*.

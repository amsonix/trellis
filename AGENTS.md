# AGENTS.md — working on project-protocol

This repository is the reference implementation of the protocol in
[`SPEC.md`](SPEC.md). Read the spec before changing a rule.

## The one rule that matters

**A rule that cannot fail is not a rule.** Every blocking check in `src/core/`
needs a negative control in `test/`: a fixture that makes it fail. If you add a
check, add the case that proves it can be red.

## Layout

```text
src/core/       pure domain; no network, no clock, no process.exit
src/cli.mjs     argument parsing, human output, JSON envelope
templates/      the files `init` writes into a new project
schema/         JSON Schemas for the state, task, evidence and profile
test/           node:test suites and fixtures
```

- Keep `src/core/` free of filesystem and terminal concerns where possible.
  The store, evidence and lease modules are the only core modules that touch
  `.project-protocol/`.
- Do not add a runtime dependency without a written reason; the project is
  intentionally dependency-free.
- `node --test` must pass before a change is called done.

## Commands

```bash
npm test
node bin/project-protocol.mjs --help
node bin/project-protocol.mjs init /tmp/pp-check
node bin/project-protocol.mjs status --dir /tmp/pp-check
```

## Protocol discipline for agents

The management directory is fixed at `<project>/.project-protocol/`. `init` may
run on an existing project; it must never overwrite `README.md`, `TASKS.md`,
`docs/` or any other existing file.

When you use this protocol on a real project:

1. **Read `status` and `next` before writing.** Do not guess the stage.
2. **Do not approve a gate for work you produced.** The approver role is part
   of the protocol; a self-approval is a bug in the process.
3. **A `done` report needs passing evidence.** Add the evidence first; a report
   without it is refused.
4. **Claim a task before writing its scope.** `task claim` creates the lease;
   `guard commit` uses it.
5. **Ask one concrete question when blocked.** Report `blocked` with one
   question, not a long status essay.
6. **Use `--observe` before enforcing a guard.** Record what it would block;
   review the audit; then make it block.
7. **Do not edit `.project-protocol/evidence.json` by hand.** Use
   `evidence add`; the record needs an id, a producer and a verdict.

## What is intentionally missing

- Measurement guard (shared target / renderer identity).
- File-level write enforcement; the guard is commit-time only.
- DSH / Super-agent integration.
- SQLite / HTTP / multi-host.

Those are roadmap items, not invariants of the current version. Do not describe
them as implemented in `README.md` or `SPEC.md` without also adding the code and
the negative control.

# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

## [0.6.1] - 2026-11-04

### Fixed

- `scope suggest` matches the task id as an exact token instead of a
  `git log --grep` substring, so `T-001` no longer picks up `T-0010`; the
  matched commits are shown before `--apply`.

### Added

- MCP now exposes `trellis_task_recover`, `proves` on `trellis_evidence_add`,
  and `archiveRetractedDays` on `trellis_compact`.

### Changed

- The agent skill names `evidence.jsonl` and `leases.archive.jsonl`, and lists
  `--proves`, `--paths` and `task recover`.
- Pushing a `v*` tag runs `release.yml`, which tests, builds the tarball,
  creates the Release when missing and uploads the asset.



### Fixed

- `task claim` checks the actor's role before returning an idempotent lease or
  taking over an orphaned claim; a wrong role is refused instead of receiving
  the existing lease.
- `task report --state done` rechecks dependencies, so a dependency added after
  the claim can no longer be skipped.
- A corrupt middle line in `evidence.jsonl` is reported as `EVIDENCE_CORRUPT`
  instead of being silently dropped; only a torn final line is ignored.
- `compact --dry-run` no longer migrates a legacy `evidence.json`.

### Changed

- State schema is 2. A schema-1 state is upgraded in memory and persisted on
  the next write; older builds refuse schema 2 instead of silently missing the
  JSONL evidence log.
- Text artifacts (including `TASKS.md`) are written through a temporary file and
  rename, matching the JSON ledgers.
- The ledger lock refreshes its timestamp while held, so a slow operation is not
  mistaken for a dead holder.
- 138 `node:test` cases.

## [0.6.0] - 2026-11-04

### Added

- `task claim` takes over an `in_progress` task whose lease no longer exists.
  The takeover keeps the status, passes the usual role and dependency checks,
  and records `task.taken_over`; `TRELLIS_NO_TAKEOVER=1` disables it.
- `task recover <T-NNN> --by human|coordinator --reason ...`: return an
  `in_progress` task with no lease to `ready` or `todo`; refuses while a lease
  is held and records `task.recovered`.
- 131 `node:test` cases.

## [0.5.1] - 2026-11-04

### Added

- `docs/scope-and-parallelism.md` records the decision that scope is the only
  concurrency primitive: no `parallel_ok` declaration; narrow the scope or add a
  dependency for real ordering.
- `scope suggest --apply --by <role>:<name>` writes the suggested file-level
  scope back to the board; it only narrows and records `task.scope.narrowed`.
- 121 `node:test` cases.

## [0.5.0] - 2026-11-04

### Added

- `guard commit --paths <a,b>` checks an explicit path set, so parallel lanes
  sharing one git index no longer block each other.
- `next` returns `alsoReady` when it stops at a gate but execution is still
  possible, instead of hiding the claimable tasks.
- `evidence add --proves "<acceptance clause>"`: optional field naming what the
  evidence is meant to prove.
- `scope suggest --task T-NNN`: proposes a file-level write scope from
  `git log --grep`, without editing the board.
- The missing-state error names the project root and suggests `--dir`,
  `TRELLIS_DIR`, `reindex` and `init`.
- 119 `node:test` cases.

## [0.4.0] - 2026-11-03

### Added

- A `Priority` column (`high`/`medium`/`low`, default `medium`) on the task
  board; `next` orders ready tasks by priority, then id. Old nine-column boards
  keep working and parse as `medium`.
- 116 `node:test` cases.

## [0.3.2] - 2026-11-03

### Fixed

- `--json` output is no longer truncated when stdout is a pipe: the CLI sets
  `process.exitCode` instead of calling `process.exit()`, so Node drains stdout
  before exiting. A 100 KB `task list --json | jq` now parses.
- 113 `node:test` cases.

## [0.3.1] - 2026-11-03

### Fixed

- Two stale plan gates that share artifacts (G3 and G4) no longer deadlock each
  other: only an earlier stale gate blocks a re-approval, so they can be
  re-approved in order. `G5` is ordered after `G4`.
- 112 `node:test` cases.

## [0.3.0] - 2026-11-03

### Added

- `scripts/release-tarball.mjs` and `docs/release.md`: build a pinned tarball and
  install it from a GitHub Release URL while the npm registry is unavailable.
- `export --a2a`: read-only A2A task view with the Trellis fields kept under
  `metadata.trellis`.
- `compact --archive-retracted <days>`: move retracted evidence older than the
  cutoff to `evidence.archive.jsonl`; pass/fail evidence is never archived.
- Chinese `CONTRIBUTING.zh.md`, a Chinese `SPEC.zh.md` reference translation and
  `docs/v0.3.0-plan.md`.

### Fixed

- Windows CI flake: renames retry on `EPERM`/`EBUSY`/`EACCES` and the ledger lock
  waits 30 s (stale after 20 s) instead of 10 s.

### Changed

- Document installing from GitHub (`npm install -g github:amsonix/trellis`,
  `npx github:amsonix/trellis`) until the npm registry publish is possible.

## [0.2.1] - 2026-11-03

### Added

- `compact [--dry-run]`: fold the evidence event log into one `add` line per
  record (retraction state included) and rotate `audit.jsonl` past 5 MB.
- Package renamed to `@amsonix/trellis` for npm publishing (the npm name
  `trellis` is taken).
- 106 `node:test` cases.

## [0.2.0] - 2026-11-03

### Added

- `TRELLIS_AGENT` stamps leases, evidence and audit entries with a worker id for
  attribution (it is not a credential).
- `examples/spec-kit/sync.mjs`: capture a Spec Kit `tasks.md` checklist into the
  task board, idempotently and in order.
- CI now runs on Windows as well as Linux, for Node 20, 22 and 24.
- Evidence is an append-only `evidence.jsonl` event log: `add` appends without
  reading the history, `retract` appends an event, and readers fold by id.
- `leases.json` holds only active leases; released leases move to
  `leases.archive.jsonl`, so the active file stays small.
- Legacy `evidence.json` and oversized `leases.json` are migrated on first read
  (`evidence.json` is renamed to `evidence.json.migrated`).
- 103 `node:test` cases.

## [0.1.1] - 2026-11-03

### Added

- `report [--json]`: gate and task counts plus the gaps — blocking checks, the
  pending gate, blocked tasks, tasks marked done without passing evidence, and
  leases older than 24 hours — with the next command.
- `report` derives per-milestone progress (done / in_progress / todo / empty)
  from the task board without writing status back into `ROADMAP.md`.
- `task add`: validate and append a task row from a requirement or a bug report,
  including the write-scope overlap check, and record `task.added` with the actor.
- Controlled follow-ups (`task add --follow-up-of T-NNN`): same milestone, inside
  the parent scope, at most three children and two levels; they keep G3/G4
  approved so a runtime can continue inside the plan.
- `task ask` / `task answer`: a question blocks the task, is recorded with its
  previous status, and surfaces as `needsUser`; only a human can answer it.
- `next` reports `needsUser` and a `reason`, so a runtime can run every ready
  batch unattended and stop only where a decision is required.
- `evidence retract <EV-id> --reason ...`: a human, reviewer or verifier can
  retire a failed record without deleting it, so a bug can go from a failing
  reproduction to a passing fix.
- Gate digests: a passed gate goes stale when the artifacts it approved change;
  `check` reports `GATE_STALE` and re-approval is the only way to clear it.
- A per-project write lock (`.trellis/.lock`) and atomic JSON writes, so parallel
  claims or evidence records are serialized instead of losing updates.
- Audit entries append to `.trellis/audit.jsonl`; `state.json` keeps the last 200
  so it does not grow with history.
- `TRELLIS_STRICT=1` makes `task claim` refuse before `G4` instead of warning.
- 97 `node:test` cases, including negative controls for every blocking rule.

### Changed

- `G5` now requires `G4`, so a task review cannot precede the plan.
- Gate digests hash normalized content (whitespace-only edits no longer stale a
  gate) and G2 covers `docs/adr/*.md`.
- `check` warns with `TASK_BEFORE_PLAN` when work starts before `G4`.

### Fixed

- Concurrent `task claim` and `evidence add` calls no longer lose updates.

### Not yet

- Measurement guard (shared target / renderer identity).
- File-level write enforcement; the guard is commit-time only.
- DSH / Super-agent integration.
- SQLite, HTTP and multi-host.

## [0.1.0] - 2026-11-03

### Added

- A dependency-free Node.js protocol and CLI for agent-facing project building.
- A fixed `<project>/.trellis/` management directory; `init` can run on
  an existing project and never overwrites existing files.
- An agent skill at `.agents/skills/trellis/SKILL.md`: `init` writes it
  once, and a runtime that reads `.agents/skills/` loads it automatically
  for that project.
- `generic` profile (the default); `--profile` and `--name` are optional.
- Profiles: `web-app`, `library`, `cli`.
- Stages and gates `G0`–`G7`, including the per-task `G5` review.
- Artifact contracts for `PROJECT`, `RESEARCH`, `ARCHITECTURE`, `ROADMAP`,
  `TASKS`, `VERIFICATION`, `OPERATIONS`, `GLOSSARY`, `INVARIANTS` and `ADR`.
- Task table parsing, dependency-cycle detection and write-scope overlap checks.
- Evidence ledger with `pass` / `fail` / `inconclusive`; `done` requires a pass.
- Leases acquired by `task claim`; `guard commit --staged` with `--observe`.
- `lease release <T-NNN> --by <role>:<name>` frees a held lease when a task is
  abandoned, blocked or crashed; the record keeps `releasedAt` and `releasedBy`.
- `status`, `check`, `next`, `gate`, `task`, `evidence`, `verify`, `lease`,
  `guard`, `reindex`, `profile`, `--json` and stable exit codes.
- `brief [--role <role>]`: the current gate, the read/write set, the role's
  prohibitions and the next commands, from the profile, the stage and the role.
- A CI-enforced coverage gate (`npm run coverage`); the thresholds are a floor,
  not a target.
- `SECURITY.md` and issue templates for bug reports and feature requests.
- An MCP server (`bin/trellis-mcp.mjs`): read tools by default, write tools with
  `TRELLIS_MCP_WRITE=1`, no gate approval.

### Fixed

- `examples/agent-brief.md` now points at `trellis brief` instead of describing
  a brief the CLI did not print.

### Not yet

- Measurement guard (shared target / renderer identity).
- File-level write enforcement; the guard is commit-time only.
- DSH / Super-agent integration.
- SQLite, HTTP and multi-host.

[0.1.1]: https://github.com/amsonix/trellis/releases/tag/v0.1.1
[0.1.0]: https://github.com/amsonix/trellis/releases/tag/v0.1.0
[0.3.0]: https://github.com/amsonix/trellis/releases/tag/v0.3.0
[0.3.1]: https://github.com/amsonix/trellis/releases/tag/v0.3.1
[0.3.2]: https://github.com/amsonix/trellis/releases/tag/v0.3.2
[0.4.0]: https://github.com/amsonix/trellis/releases/tag/v0.4.0
[0.5.0]: https://github.com/amsonix/trellis/releases/tag/v0.5.0
[0.5.1]: https://github.com/amsonix/trellis/releases/tag/v0.5.1
[0.6.0]: https://github.com/amsonix/trellis/releases/tag/v0.6.0
[0.6.1]: https://github.com/amsonix/trellis/releases/tag/v0.6.1
[0.6.2]: https://github.com/amsonix/trellis/releases/tag/v0.6.2
[0.6.3]: https://github.com/amsonix/trellis/releases/tag/v0.6.3
[0.7.0]: https://github.com/amsonix/trellis/releases/tag/v0.7.0

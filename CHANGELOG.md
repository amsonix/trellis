# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

## [0.9.19] - 2026-11-10

### Fixed

- `next` no longer puts a passed-but-stale plan gate ahead of claimable work:
  execution allowed by G4 returns the ready tasks with a `GATE_STALE`
  attention entry; the stale gate is returned only when no work is claimable.
- `task list --status` validates the closed set; an unknown or empty value is a
  USAGE error instead of an empty success.
- `task list` help names `--status/--role/--ready/--limit`, and `task recover`
  accepts its documented `--to`.
- `task list --json` also returns `items` as an alias for `tasks`.
- 212 `node:test` cases.

## [0.9.18] - 2026-11-05

### Fixed

- `evidence retract` no longer treats the evidence id as the project directory:
  the `evidence` branch resolves the dir from positional 1, and `dirOf` refuses
  id-shaped positionals (`EV-…`, `T-…`, `Q-…`). The documented default (cwd)
  now works without `--dir`.
- `EVIDENCE_UNKNOWN` reports `{ root, shards }` so a wrong directory is
  distinguishable from a missing record.
- 208 `node:test` cases.

## [0.9.17] - 2026-11-05

### Changed

- Reporting `done` now writes an explicit `lease.released` audit event with
  `reason: "task.done"` and `implicit: true` (the lease was already released).
- A regression test covers claim -> evidence -> done -> empty `lease status`.
- 206 `node:test` cases.

## [0.9.16] - 2026-11-05

### Fixed

- `lease status` with a held lease no longer throws `INTERNAL: state is not
  defined`; the loaded state is bound before the printer reads it.
- 205 `node:test` cases.

## [0.9.15] - 2026-11-05

### Fixed

- `next --batch` with fewer ready tasks returns what exists plus
  `batchRequested`/`batchShortfall`, and no longer replaces the active
  `in_progress` fallback with an empty batch.
- 204 `node:test` cases.

## [0.9.14] - 2026-11-05

### Added

- `next --batch <n> [--strategy priority|unblock|oldest]`: a deterministic,
  scope-disjoint batch with `why` per task. `next` remains read-only; the agent
  still claims each task explicitly.
- The agent skill tells agents to select work through `next --batch`, not by
  reading titles.
- 202 `node:test` cases.

## [0.9.13] - 2026-11-05

### Changed

- `done`/`review` can be reopened to `todo` as well as `in_progress`; moving
  `in_progress -> todo` requires that no lease is held.
- `lease` checks for protocol state first, so running it outside a project
  reports UNAVAILABLE instead of a misleading `LEASE_NOT_HELD`.
- 200 `node:test` cases.

## [0.9.12] - 2026-11-05

### Changed

- `lease reap` accepts a coordinator when the holder is an executor and no audit
  event followed the claim; the coordinator must pass `--reason`. `lease status`
  prints an idle time as well as the lease age.
- `EVIDENCE_TREE_DRIFT` only warns for `review`/`done`; HEAD moving under an
  active task in a shared tree is normal.
- The missing-column error says to append the column last, since Trellis reads
  by header name and appending keeps positional readers stable.
- 197 `node:test` cases.

## [0.9.11] - 2026-11-05

### Fixed

- `task edit --priority` on a board whose table has no `priority` column is now
  refused with a USAGE error instead of being audited and discarded. The same
  guard applies to `task add` with a non-default priority.
- 194 `node:test` cases.

## [0.9.10] - 2026-11-05

### Changed

- `done` and `review` can be reopened to `in_progress` by a human or coordinator
  with `--note <reason>`; the reopen is audited and clears the task's G5
  approval.
- Unsatisfied dependencies on a `done` task are a warning, not a refusal;
  dependencies gate `claim`, not closure.
- `next` includes a ready-task `candidate` (marked `blockedBy: <gate>`) while a
  gate is pending.
- 194 `node:test` cases.

## [0.9.9] - 2026-11-05

### Fixed

- Restore the missing 0.9.6–0.9.8 changelog entries. A test now fails when the
  current `package.json` version has no `CHANGELOG.md` section.

## [0.9.8] - 2026-11-05

### Fixed

- `task edit` validates the delta, not the whole board: a pre-existing conflict
  no longer disables the only repair command. Clearing dependencies and
  narrowing scope are always allowed; other edits are refused only when they
  introduce a new blocking check.
- `task edit` accepts `--scope` (CLI and MCP).

## [0.9.7] - 2026-11-05

### Fixed

- `trellis lease reap` now reaches the reaper; the help entry existed but the
  dispatcher had no branch.
- A source-level test fails when a `command:subcommand` help key has no
  dispatcher branch.

## [0.9.6] - 2026-11-05

### Fixed

- Gate digests hash tasks in id order, so moving a completed row between board
  sections no longer makes G3/G4 stale; earlier approvals still compare against
  arrival order and stay valid.
- A status cell may carry a note after the status word (`done — closed by lane`).
- Test cleanup retries Windows `EBUSY`/`EPERM` on temporary directories.

## [0.9.5] - 2026-11-05

### Fixed

- `task claim --paths <a,b>` leases only the named subset of the task scope, so
  one held file no longer blocks a claim that needs a different file.
- A board scope containing a glob or `?`/`[]` is refused at claim time with
  `TASK_SCOPE_INVALID` instead of being accepted and then refused by `guard`.
- `lease reap --older-than <hours> --by human:<name>` releases stale leases.
- The project lock waits 60s instead of 30s, so ten concurrent CLI writers do
  not exhaust the wait on Windows.

## [0.9.4] - 2026-11-05

### Added

- `task add --from <tasks.json>` imports up to 200 tasks through the normal
  validator; import is incremental and stops at the first invalid item.
- 178 tests.

## [0.9.3] - 2026-11-04

### Added

- `task edit` for title, acceptance, verification, dependencies and priority,
  with `task.edited` audit.
- `task list --status/--role/--ready/--limit`.
- `compact --logs-keep <days>` prunes unreferenced `task finish` logs.
- `trellis_task_edit` MCP tool.

### Fixed

- Unknown task statuses surface as `TASK_STATUS_INVALID` in `next` and `claim`.
- Gate digests split structure from content: prose edits warn as
  `GATE_CONTENT_DRIFT`, structural edits still go `GATE_STALE`.

## [0.9.2] - 2026-11-04

### Added

- Evidence records `commit`, `dirty` and `worktree`; `verify` warns with
  `EVIDENCE_TREE_DRIFT` after HEAD moves.
- `task finish --run "<command>"`: run, log under `.trellis/logs/`, record
  evidence, report done only on exit 0.
- `lease status` shows the agent and lease age.
- `trellis_task_finish` MCP tool.

### Fixed

- `finish` runs commands from a batch file on Windows (cmd.exe quote handling).
- The coverage gate runs once on Ubuntu/Node 22.

## [0.9.1] - 2026-11-04

### Added

- `trellis backup --out` / `trellis restore --from [--force]` with a manifest.
- `docs/security-model.md`: trust boundary, handled threats and non-goals.
- Fault-injection tests: corrupt state/leases, read-only `.trellis`, migration
  idempotence.

### Fixed

- Writes and appends fsync files and directories.
- The lock checks the owner PID before stealing a stale lock.
- Release notes carry the tarball sha256; CI adds macOS.

## [0.9.0] - 2026-11-04

### Changed

- **Breaking storage:** evidence moves to per-task shards
  `.trellis/evidence/T-*.jsonl` (schema 3). Older builds refuse schema 3; the
  v2 log migrates lazily on first read and is renamed `.migrated`.
- `compact` folds each shard and archives retracted records.
- Reading one task no longer scans the whole evidence log.

## [0.8.0] - 2026-11-04

### Added

- `a2a serve` HTTP endpoint with an agent card and `tasks/get|list|cancel`;
  `message/send` is refused by design.
- Evidence parsing cache for repeated A2A exports.

## [0.7.0] - 2026-11-04

### Added

- Terminal `canceled` task state via `task cancel`; it does not satisfy
  dependencies and G6 warns with `TASK_CANCELED`.
- Per-task evidence reads and a richer A2A export.

### Fixed

- CI serializes test files on Windows and surfaces the failure tail.

## [0.6.3] - 2026-11-04

### Added

- Per-actor lease cap (`TRELLIS_MAX_LEASES`) and `next --limit`.

## [0.6.2] - 2026-11-04

### Added

- Per-command help, `trellis doctor`, and contract tests for the JSON envelope,
  A2A, MCP and schemas.

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
[0.8.0]: https://github.com/amsonix/trellis/releases/tag/v0.8.0
[0.9.0]: https://github.com/amsonix/trellis/releases/tag/v0.9.0
[0.9.1]: https://github.com/amsonix/trellis/releases/tag/v0.9.1
[0.9.2]: https://github.com/amsonix/trellis/releases/tag/v0.9.2
[0.9.3]: https://github.com/amsonix/trellis/releases/tag/v0.9.3
[0.9.4]: https://github.com/amsonix/trellis/releases/tag/v0.9.4
[0.9.5]: https://github.com/amsonix/trellis/releases/tag/v0.9.5
[0.9.6]: https://github.com/amsonix/trellis/releases/tag/v0.9.6
[0.9.7]: https://github.com/amsonix/trellis/releases/tag/v0.9.7
[0.9.8]: https://github.com/amsonix/trellis/releases/tag/v0.9.8
[0.9.9]: https://github.com/amsonix/trellis/releases/tag/v0.9.9
[0.9.10]: https://github.com/amsonix/trellis/releases/tag/v0.9.10
[0.9.11]: https://github.com/amsonix/trellis/releases/tag/v0.9.11
[0.9.12]: https://github.com/amsonix/trellis/releases/tag/v0.9.12
[0.9.13]: https://github.com/amsonix/trellis/releases/tag/v0.9.13
[0.9.14]: https://github.com/amsonix/trellis/releases/tag/v0.9.14
[0.9.15]: https://github.com/amsonix/trellis/releases/tag/v0.9.15
[0.9.16]: https://github.com/amsonix/trellis/releases/tag/v0.9.16
[0.9.17]: https://github.com/amsonix/trellis/releases/tag/v0.9.17
[0.9.18]: https://github.com/amsonix/trellis/releases/tag/v0.9.18
[0.9.19]: https://github.com/amsonix/trellis/releases/tag/v0.9.19

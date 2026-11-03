# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

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
- 49 `node:test` cases, including negative controls for every blocking rule.

### Fixed

- `examples/agent-brief.md` now points at `trellis brief` instead of describing
  a brief the CLI did not print.

### Not yet

- Measurement guard (shared target / renderer identity).
- File-level write enforcement; the guard is commit-time only.
- DSH / Super-agent integration.
- SQLite, HTTP and multi-host.

[0.1.0]: https://github.com/amsonix/trellis/releases/tag/v0.1.0

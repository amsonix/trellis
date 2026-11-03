# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-03

### Added

- A dependency-free Node.js protocol and CLI for agent-facing project building.
- Profiles: `web-app`, `library`, `cli`.
- Stages and gates `G0`–`G7`, including the per-task `G5` review.
- Artifact contracts for `PROJECT`, `RESEARCH`, `ARCHITECTURE`, `ROADMAP`,
  `TASKS`, `VERIFICATION`, `OPERATIONS`, `GLOSSARY`, `INVARIANTS` and `ADR`.
- Task table parsing, dependency-cycle detection and write-scope overlap checks.
- Evidence ledger with `pass` / `fail` / `inconclusive`; `done` requires a pass.
- Leases acquired by `task claim`; `guard commit --staged` with `--observe`.
- `status`, `check`, `next`, `gate`, `task`, `evidence`, `verify`, `lease`,
  `guard`, `reindex`, `profile`, `--json` and stable exit codes.
- 30 `node:test` cases, including negative controls for every blocking rule.

### Not yet

- Measurement guard (shared target / renderer identity).
- File-level write enforcement; the guard is commit-time only.
- DSH / Super-agent integration.
- SQLite, HTTP and multi-host.

[0.1.0]: https://example.local/project-protocol/CHANGELOG.md

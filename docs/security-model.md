# Security model

Status: 0.9.x. This is what Trellis protects against, and what it does not.

## Trust boundary

Trellis is a **local, single-user, trusted-agent** protocol. Its job is to keep
an agent honest about what it claims to have done, not to defend a host from a
malicious process.

| Actor | Assumed |
|---|---|
| The human | trusted; approves gates and answers questions |
| The agent runtime | trusted to run the CLI; may be careless, not adversarial |
| Other local users | not modeled; `.trellis/` permissions are the OS's job |
| The network | not used; the A2A endpoint binds `127.0.0.1` by default |

## Threats that are handled

- **Unsupported "done" claims** — `report --state done` requires passing evidence
  for the task; a failing or missing record refuses it.
- **Self-approval** — a gate approver role must match the gate definition; the
  producing role cannot approve its own work.
- **Write-domain drift** — a task must claim its scope; `guard commit` compares
  paths against the task scope and other held leases.
- **Path escape through scope** — `*`, `..`, absolute paths and backslashes are
  rejected; a board row with an unsafe scope fails `TASK_SCOPE_INVALID`.
- **Evidence outside the project** — a local evidence URI must stay inside the
  project root; external evidence uses a URL or commit.
- **Lost updates** — a project lock plus atomic, fsync'd writes serialize
  mutations; a crash cannot leave a half-written JSON or task table.
- **Stale gate approvals** — digests make an approval stale when its artifacts
  change; re-approval is required.
- **Unbounded input** — titles, questions and reasons have length limits; table
  cells cannot contain `|` or newlines.

## Threats that are NOT handled

- **Malicious local processes.** Any process that can write `.trellis/` can edit
  the ledgers directly. `guard` is advisory and commit-time only; there is no
  file-level enforcement or OS sandbox.
- **Forged identity.** `--by role:name` is self-declared. `TRELLIS_AGENT` is
  attribution, not authentication; there are no signed actors.
- **Multi-tenant or remote use.** The A2A endpoint has no authentication or TLS.
  Do not expose it beyond localhost.
- **Confidentiality.** Artifacts are plain Markdown/JSON on disk; encryption at
  rest is the filesystem's job.
- **Supply chain.** The package is distributed via GitHub tags/tarballs; there is
  no npm provenance signature. Verify the release checksum.

## Deployment guidance

- One project per filesystem directory; one writer set at a time.
- Back up with `trellis backup --out <dir>` before upgrades; restore with
  `trellis restore --from <dir> [--force]`.
- Run the A2A endpoint only on localhost; put an authenticating proxy in front if
  it must be reachable.
- Treat the audit log and `.migrated` evidence files as the record of what
  happened; do not delete them during an investigation.
